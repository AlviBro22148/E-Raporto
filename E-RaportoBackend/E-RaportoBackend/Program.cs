using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using E_RaportoBackend.Data;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using E_RaportoBackend.Services.Ai;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

// User secrets are normally loaded automatically, but only when the host resolves
// ASPNETCORE_ENVIRONMENT to "Development" — and that resolution depends on which launch profile a
// given shell/IDE happens to pick, which has proven inconsistent across terminals on this machine.
// Loading secrets unconditionally removes that dependency entirely: `dotnet run` finds the local
// Postgres password no matter which terminal, launch profile, or environment variable state it's
// run from. `optional: true` makes this a no-op wherever the file doesn't exist — i.e. everywhere
// except this developer's machine — so it carries no risk for any real deployment.
builder.Configuration.AddUserSecrets<Program>(optional: true);

// ── Configuration ───────────────────────────────────────────────────────────────
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.SectionName));
builder.Services.Configure<DuplicateDetectionOptions>(
    builder.Configuration.GetSection(DuplicateDetectionOptions.SectionName));
builder.Services.Configure<SystemicPatternOptions>(
    builder.Configuration.GetSection(SystemicPatternOptions.SectionName));

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured. Set it via user-secrets or the " +
        "ConnectionStrings__Default environment variable — see README.md.");

var jwtKey = builder.Configuration["Jwt:SigningKey"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException("Jwt:SigningKey must be configured outside Development.");

    // Development-only convenience so a fresh clone runs with zero setup. Any real deployment
    // supplies its own key; the guard above makes forgetting it a startup failure, not a silent weakness.
    jwtKey = "dev-only-signing-key-e-raporto-elbasan-2026-do-not-use-in-production";
    builder.Configuration["Jwt:SigningKey"] = jwtKey;
}

// ── Services ────────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));

builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<ReportWorkflow>();
builder.Services.AddScoped<DuplicateDetectionService>();
builder.Services.AddScoped<SystemicPatternDetectionService>();
builder.Services.AddScoped<PhotoReuseDetectionService>();
builder.Services.AddScoped<IPatternSynthesizer, ClaudePatternSynthesizer>();
builder.Services.AddScoped<INoteTranslator, ClaudeNoteTranslator>();
builder.Services.AddScoped<ReportTriageService>();
builder.Services.AddScoped<ReportDossierService>();
builder.Services.AddSingleton<IPhotoStorage, LocalPhotoStorage>();

builder.Services.AddHttpClient(nameof(ExpoPushNotificationService), c =>
{
    c.Timeout = TimeSpan.FromSeconds(10);   // a slow push send must never hold up a status change
});
builder.Services.AddScoped<IPushNotificationService, ExpoPushNotificationService>();

// The rule-based classifier is registered concretely as well as behind the interface: the Claude
// implementation depends on it directly as its fallback, which is what keeps the demo alive.
builder.Services.AddScoped<RuleBasedReportClassifier>();
builder.Services.AddScoped<IReportClassifier, ClaudeReportClassifier>();

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddProblemDetails();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "e-raporto",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "e-raporto-clients",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        // A browser cannot set an Authorization header on a WebSocket handshake, so the SignalR clients
        // put the token in the query string instead. Accepted for the hub path only — a token in a URL
        // is far more likely to end up in a log or a referrer than one in a header, so this must never
        // become a general-purpose way to authenticate against the REST API.
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/realtime"))
                    context.Token = accessToken;

                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

// An abuse floor on report submission, without adding friction for genuine citizens.
// Partitioned by account: submission now requires auth, so the JWT subject is the right key.
// Falling back to the remote IP only matters for an unauthenticated request, which the endpoint
// rejects anyway — but keying every such request together would let one bad actor exhaust the
// bucket for everyone behind the same NAT, so the fallback stays per-IP rather than global.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("submit-report", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirst(
                System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromHours(1)
        }));

    // Login has no JWT yet to partition by, so this is IP-only — the one gap that leaves: a bad actor
    // rotating IPs (or many attackers behind one NAT sharing a bucket) isn't fully solved by a single
    // in-process limiter. That is a real limitation, not an oversight; a production deployment behind a
    // WAF/CDN should treat this as a second layer, not the only one. What it does close outright is the
    // simple case this had zero protection against: one client hammering one account's password.
    o.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(5)
        }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var allowed = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    if (allowed.Length > 0)
    {
        p.WithOrigins(allowed).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    }
    else
    {
        // Expo Go dials in from whatever LAN IP the phone resolves, so an origin allowlist is
        // impractical during the hackathon. Deployments set Cors:AllowedOrigins explicitly.
        //
        // SetIsOriginAllowed rather than AllowAnyOrigin: the two look equivalent but are not. AllowAnyOrigin
        // answers with a literal `*`, and a browser refuses `*` on any credentialed request — which is what
        // the dashboard's SignalR negotiate is. Reflecting the caller's own origin keeps the same
        // "anything on the LAN" behaviour while staying usable with AllowCredentials.
        p.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    }
}));

builder.Services.AddSignalR();
builder.Services.AddScoped<IRealtimeBroadcaster, RealtimeBroadcaster>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "E-Raporto API",
        Version = "v1",
        Description =
            "Citizen reporting and municipal request management for Bashkia Elbasan. " +
            "One API serves both the citizen mobile app and the staff " +
            "dashboard (JWT). Built for the AI4Society Youth Innovation Hackathon, Track A."
    });

    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Paste the token returned by POST /api/v1/auth/login."
    });
    o.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document)] = []
    });

    var xmlPath = Path.Combine(AppContext.BaseDirectory, "E-RaportoBackend.xml");
    if (File.Exists(xmlPath)) o.IncludeXmlComments(xmlPath);
});

var app = builder.Build();

// ── Migrate + seed on boot ──────────────────────────────────────────────────────
// Reproducible schema and a populated demo on any machine with one command. The jury and the
// mentors have to be able to run this in under five minutes.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        await db.Database.MigrateAsync();
        await DbSeeder.SeedAsync(db, logger);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database migration/seed failed. Check ConnectionStrings:Default.");
        throw;
    }
}

app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseSwagger();
app.UseSwaggerUI(o =>
{
    o.SwaggerEndpoint("/swagger/v1/swagger.json", "E-Raporto API v1");
    o.DocumentTitle = "E-Raporto API";
});

app.UseStaticFiles();          // serves uploaded photos from wwwroot/uploads
app.UseCors();
app.UseAuthentication();
// AFTER UseAuthentication, deliberately: the submit-report policy partitions by the JWT subject,
// and context.User is not populated until authentication has run. With the rate limiter first,
// every request would silently fall into the same IP-keyed bucket.
app.UseRateLimiter();
app.UseAuthorization();

app.MapControllers();
app.MapHub<GlobalNotificationHub>("/hubs/realtime");

app.MapGet("/health", async (AppDbContext db, Microsoft.Extensions.Options.IOptions<AnthropicOptions> ai) =>
{
    var dbHealthy = await db.Database.CanConnectAsync();
    return Results.Ok(new
    {
        status = dbHealthy ? "Healthy" : "Degraded",
        database = dbHealthy ? "Healthy" : "Unreachable",
        // Named honestly: "Fallback" means the rule-based classifier is what will actually run.
        aiProvider = ai.Value.Enabled && !string.IsNullOrWhiteSpace(ai.Value.ApiKey) ? "Configured" : "Fallback",
        model = ai.Value.Model,
        utc = DateTime.UtcNow
    });
}).WithTags("Health").AllowAnonymous();

app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.Run();
