using E_RaportoBackend.Domain;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Municipality> Municipalities => Set<Municipality>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<StaffUser> StaffUsers => Set<StaffUser>();
    public DbSet<CitizenUser> CitizenUsers => Set<CitizenUser>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<ReportPhoto> ReportPhotos => Set<ReportPhoto>();
    public DbSet<ReportStatusHistory> ReportStatusHistory => Set<ReportStatusHistory>();
    public DbSet<DuplicateCandidate> DuplicateCandidates => Set<DuplicateCandidate>();
    public DbSet<PhotoReuseFlag> PhotoReuseFlags => Set<PhotoReuseFlag>();
    public DbSet<CitizenNotification> CitizenNotifications => Set<CitizenNotification>();
    public DbSet<ReportConfirmation> ReportConfirmations => Set<ReportConfirmation>();
    public DbSet<ResolutionVerification> ResolutionVerifications => Set<ResolutionVerification>();
    public DbSet<SystemicPattern> SystemicPatterns => Set<SystemicPattern>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<Municipality>(e =>
        {
            e.ToTable("municipality");
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Slug).HasMaxLength(60).IsRequired();
            e.Property(x => x.RefPrefix).HasMaxLength(8).IsRequired();
            e.Property(x => x.Timezone).HasMaxLength(60);
        });

        b.Entity<Department>(e =>
        {
            e.ToTable("department");
            e.Property(x => x.Name).HasMaxLength(240).IsRequired();
            e.Property(x => x.ShortName).HasMaxLength(80).IsRequired();
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.HasOne(x => x.Municipality).WithMany(x => x.Departments)
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
            // WithMany() with no back-reference: StaffUser has no "DepartmentsIAmDefaultAssigneeFor"
            // collection, and none is needed for anything the app does today.
            e.HasOne(x => x.DefaultAssignee).WithMany()
                .HasForeignKey(x => x.DefaultAssigneeStaffId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.MunicipalityId);
        });

        b.Entity<Category>(e =>
        {
            e.ToTable("category");
            e.Property(x => x.Code).HasMaxLength(40).IsRequired();
            e.Property(x => x.NameSq).HasMaxLength(120).IsRequired();
            e.Property(x => x.NameEn).HasMaxLength(120).IsRequired();
            e.Property(x => x.Description).HasMaxLength(600);
            e.Property(x => x.ColorHex).HasMaxLength(9);
            e.Property(x => x.Icon).HasMaxLength(40);
            e.HasIndex(x => new { x.MunicipalityId, x.Code }).IsUnique();
            e.HasOne(x => x.Municipality).WithMany(x => x.Categories)
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.DefaultDepartment).WithMany(x => x.Categories)
                .HasForeignKey(x => x.DefaultDepartmentId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<StaffUser>(e =>
        {
            e.ToTable("staff_user");
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(160).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
            e.Property(x => x.FullName).HasMaxLength(160).IsRequired();
            e.Property(x => x.JobTitle).HasMaxLength(160);
            e.HasOne(x => x.Municipality).WithMany()
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Department).WithMany(x => x.Staff)
                .HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<CitizenUser>(e =>
        {
            e.ToTable("citizen_user");
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(160).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
            e.Property(x => x.FullName).HasMaxLength(160).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.PushToken).HasMaxLength(200);
            e.Property(x => x.Pseudonym).HasMaxLength(12).IsRequired();
            // Unique because a repeated handle would silently merge two citizens into one identity in a
            // duplicate review — the one place staff act on it. The generator's odds are not the
            // guarantee; this is.
            e.HasIndex(x => x.Pseudonym).IsUnique();
            e.HasOne(x => x.Municipality).WithMany()
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Report>(e =>
        {
            e.ToTable("report");
            e.HasIndex(x => x.PublicRef).IsUnique();
            e.Property(x => x.PublicRef).HasMaxLength(24).IsRequired();
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.TitleEn).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(4000).IsRequired();
            e.Property(x => x.DescriptionSq).HasMaxLength(4000);
            e.Property(x => x.DescriptionEn).HasMaxLength(4000);
            e.Property(x => x.AddressText).HasMaxLength(300);
            e.Property(x => x.ReporterLabel).HasMaxLength(12).IsRequired();
            e.Property(x => x.AiReasoning).HasMaxLength(1000);
            e.Property(x => x.AiReasoningEn).HasMaxLength(1000);
            e.Property(x => x.AiSummarySq).HasMaxLength(300);
            e.Property(x => x.AiModel).HasMaxLength(80);
            e.Property(x => x.OverrideReason).HasMaxLength(500);

            e.HasOne(x => x.Municipality).WithMany()
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Category).WithMany()
                .HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Department).WithMany()
                .HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.AssignedToStaff).WithMany()
                .HasForeignKey(x => x.AssignedToStaffId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.MergedIntoReport).WithMany()
                .HasForeignKey(x => x.MergedIntoReportId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.ReporterUser).WithMany()
                .HasForeignKey(x => x.ReporterUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.SystemicPattern).WithMany(x => x.Members)
                .HasForeignKey(x => x.SystemicPatternId).OnDelete(DeleteBehavior.SetNull);

            // Bounding-box map queries and the dashboard's default filters.
            e.HasIndex(x => new { x.MunicipalityId, x.Status });
            e.HasIndex(x => new { x.Latitude, x.Longitude });
            e.HasIndex(x => x.ReporterUserId);
            e.HasIndex(x => x.CategoryId);
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.SystemicPatternId);
        });

        b.Entity<ReportPhoto>(e =>
        {
            e.ToTable("report_photo");
            e.Property(x => x.Url).HasMaxLength(500).IsRequired();
            e.Property(x => x.StoragePath).HasMaxLength(500);
            e.Property(x => x.ContentType).HasMaxLength(80);
            e.HasOne(x => x.Report).WithMany(x => x.Photos)
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ReportStatusHistory>(e =>
        {
            e.ToTable("report_status_history");
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.ChangedByLabel).HasMaxLength(160).IsRequired();
            e.HasOne(x => x.Report).WithMany(x => x.StatusHistory)
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ReportId, x.CreatedAt });
        });

        b.Entity<DuplicateCandidate>(e =>
        {
            e.ToTable("duplicate_candidate");
            e.Property(x => x.Method).HasMaxLength(80);
            e.HasIndex(x => new { x.ReportId, x.CandidateReportId }).IsUnique();
            e.HasIndex(x => x.ReviewStatus);
            e.HasOne(x => x.Report).WithMany()
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CandidateReport).WithMany()
                .HasForeignKey(x => x.CandidateReportId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<PhotoReuseFlag>(e =>
        {
            e.ToTable("photo_reuse_flag");
            e.HasIndex(x => new { x.ReportId, x.MatchedReportId }).IsUnique();
            e.HasIndex(x => x.ReviewStatus);
            e.HasOne(x => x.Report).WithMany()
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.MatchedReport).WithMany()
                .HasForeignKey(x => x.MatchedReportId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<CitizenNotification>(e =>
        {
            e.ToTable("citizen_notification");
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.Body).HasMaxLength(600).IsRequired();
            e.HasOne(x => x.Report).WithMany()
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CitizenUser).WithMany()
                .HasForeignKey(x => x.CitizenUserId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.CitizenUserId, x.IsRead });
        });

        b.Entity<ReportConfirmation>(e =>
        {
            e.ToTable("report_confirmation");
            // The actual enforcement of "one confirmation per user" — a unique index the database
            // itself guarantees, so a race between two rapid taps can't double-count.
            e.HasIndex(x => new { x.ReportId, x.CitizenUserId }).IsUnique();
            e.HasOne(x => x.Report).WithMany()
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CitizenUser).WithMany()
                .HasForeignKey(x => x.CitizenUserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ResolutionVerification>(e =>
        {
            e.ToTable("resolution_verification");
            e.Property(x => x.Comment).HasMaxLength(1000);
            e.Property(x => x.PhotoUrl).HasMaxLength(500);
            // One answer per resolution, guaranteed by the database rather than by the pre-check in the
            // controller alone — same reasoning as report_confirmation's unique index. ResolvedAt is part
            // of the key on purpose: it is what lets a reopened case be asked about a second time without
            // ever letting one resolution be answered twice.
            e.HasIndex(x => new { x.ReportId, x.ResolvedAt }).IsUnique();
            e.HasIndex(x => x.CitizenUserId);
            e.HasOne(x => x.Report).WithMany()
                .HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CitizenUser).WithMany()
                .HasForeignKey(x => x.CitizenUserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SystemicPattern>(e =>
        {
            e.ToTable("systemic_pattern");
            e.Property(x => x.AiSummarySq).HasMaxLength(600);
            e.Property(x => x.AiModel).HasMaxLength(80);
            e.HasIndex(x => x.ReviewStatus);
            // The lookup that answers "does an open pattern already exist near here, in this category?"
            // before a new one is created — run on nearly every report submission, so it earns its
            // own composite index rather than relying on the individual columns' indexes to compose.
            e.HasIndex(x => new { x.MunicipalityId, x.CategoryId, x.ReviewStatus });
            e.HasOne(x => x.Municipality).WithMany()
                .HasForeignKey(x => x.MunicipalityId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Category).WithMany()
                .HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Department).WithMany()
                .HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        });

        // Postgres columns in snake_case so the schema reads naturally to anyone auditing it in psql.
        foreach (var entity in b.Model.GetEntityTypes())
        {
            foreach (var prop in entity.GetProperties())
            {
                prop.SetColumnName(ToSnakeCase(prop.Name));
            }
        }
    }

    private static string ToSnakeCase(string name)
    {
        var sb = new System.Text.StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (!char.IsUpper(name[i - 1]) || (i + 1 < name.Length && !char.IsUpper(name[i + 1]))))
                    sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            else sb.Append(c);
        }
        return sb.ToString();
    }
}
