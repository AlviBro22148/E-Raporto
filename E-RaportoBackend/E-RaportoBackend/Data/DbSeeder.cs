using E_RaportoBackend.Domain;
using E_RaportoBackend.Services;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Data;

/// <summary>
/// Seeds Bashkia Elbasan's *configuration*: the municipality, its directorates, the issue taxonomy
/// with its routing rules, and the staff accounts.
///
/// It deliberately seeds no reports. Reports now belong to real citizen accounts, and a map full of
/// reports attributed to accounts nobody can sign into would make the attribution, the "my reports"
/// screen and the one-confirmation-per-user rule all demonstrate fiction. The map starts empty and
/// fills with genuinely submitted reports — which is also a more honest thing to show a jury.
/// </summary>
public static class DbSeeder
{
    public const string DemoPassword = "Elbasan2026!";

    public static async Task SeedAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        if (await db.Municipalities.AnyAsync(ct))
        {
            logger.LogInformation("Database already seeded — reconciling configuration only.");
            await SyncCategoryPresentationAsync(db, logger, ct);
            await SyncDefaultAssigneesAsync(db, logger, ct);
            return;
        }

        logger.LogInformation("Seeding Elbasan demo data…");

        var municipality = new Municipality
        {
            Name = "Bashkia Elbasan",
            Slug = "elbasan",
            RefPrefix = "ELB",
            CenterLat = 41.1125,
            CenterLng = 20.0822,
            DefaultMapRadiusM = 6000,
            Timezone = "Europe/Tirane"
        };
        db.Municipalities.Add(municipality);

        // ── Departments ─────────────────────────────────────────────────────────
        var infra = Dept(municipality, "Drejtoria e Infrastrukturës dhe Rrugëve", "Infrastruktura",
            "infrastruktura@elbasan.gov.al", "+355 54 400 111", 120);
        var cleaning = Dept(municipality, "Ndërmarrja e Shërbimeve Publike", "Shërbimet Publike",
            "sherbimet@elbasan.gov.al", "+355 54 400 222", 48);
        var lighting = Dept(municipality, "Sektori i Ndriçimit Publik", "Ndriçimi",
            "ndricimi@elbasan.gov.al", "+355 54 400 333", 72);
        var water = Dept(municipality, "UK Elbasan sh.a.", "Ujësjellësi",
            "info@ukelbasan.al", "+355 54 400 444", 36);
        var green = Dept(municipality, "Drejtoria e Gjelbërimit dhe Hapësirave Publike", "Gjelbërimi",
            "gjelberimi@elbasan.gov.al", "+355 54 400 555", 168);
        var frontDesk = Dept(municipality, "Zyra e Marrëdhënieve me Qytetarin", "Zyra e Qytetarit",
            "qytetari@elbasan.gov.al", "+355 54 400 000", 96);
        db.Departments.AddRange(infra, cleaning, lighting, water, green, frontDesk);

        // ── Categories (taxonomy + routing rules, both configurable per municipality) ────
        var catRoads = Cat(municipality, "roads", "Rrugë dhe infrastrukturë", "Roads & infrastructure",
            "Gropa në rrugë, asfalt i dëmtuar, trotuare të prishura, kapakë pusetash që mungojnë, sinjalistikë dhe semaforë të dëmtuar.",
            infra, "#E8590C", "road", 1);
        var catWaste = Cat(municipality, "waste", "Mbeturina dhe pastrimi", "Waste & cleaning",
            "Mbeturina të pambledhura, kontejnerë të mbushur ose të dëmtuar, derdhje të paligjshme mbeturinash, erë e keqe nga grumbullimet.",
            cleaning, "#2F9E44", "trash", 2);
        var catLighting = Cat(municipality, "lighting", "Ndriçimi publik", "Public lighting",
            "Llamba rruge të fikura ose të dëmtuara, shtylla ndriçimi të prishura, zona publike pa ndriçim gjatë natës.",
            lighting, "#B08000", "bulb", 3);
        var catWater = Cat(municipality, "water", "Ujësjellës dhe kanalizime", "Water & sewage",
            "Rrjedhje uji, tubacione të plasura, mungesë uji të pijshëm, kanalizime të bllokuara, përmbytje nga rrjeti.",
            water, "#339AF0", "droplet", 4);
        var catSpaces = Cat(municipality, "public_spaces", "Hapësira publike dhe gjelbërim", "Public spaces & greenery",
            "Parqe dhe lulishte të papërkujdesura, stola dhe lodra të dëmtuara, pemë të rrezikshme, grafite në hapësira publike.",
            green, "#845EF7", "tree", 5);
        var catOther = Cat(municipality, "other", "Tjetër", "Other",
            "Çështje që nuk përshtaten në kategoritë e tjera dhe kërkojnë shqyrtim nga zyra e qytetarit.",
            frontDesk, "#E64980", "alert", 6);
        db.Categories.AddRange(catRoads, catWaste, catLighting, catWater, catSpaces, catOther);

        // ── Staff ───────────────────────────────────────────────────────────────
        var hash = BCrypt.Net.BCrypt.HashPassword(DemoPassword);
        var admin = Staff(municipality, null, "admin@elbasan.gov.al", "Arta Hoxha",
            "Koordinatore e Platformës Dixhitale", StaffRole.Admin, hash);
        var infraSup = Staff(municipality, infra, "i.meta@elbasan.gov.al", "Ilir Meta",
            "Përgjegjës i Infrastrukturës", StaffRole.Supervisor, hash);
        var cleanSup = Staff(municipality, cleaning, "b.dervishi@elbasan.gov.al", "Blerina Dervishi",
            "Përgjegjëse e Shërbimeve Publike", StaffRole.Supervisor, hash);
        var lightAgent = Staff(municipality, lighting, "g.rama@elbasan.gov.al", "Genti Rama",
            "Teknik i Ndriçimit Publik", StaffRole.FieldAgent, hash);
        var waterSup = Staff(municipality, water, "e.brahimi@ukelbasan.al", "Endrit Brahimi",
            "Përgjegjës i Rrjetit", StaffRole.Supervisor, hash);
        db.StaffUsers.AddRange(admin, infraSup, cleanSup, lightAgent, waterSup);

        // Saved before the default-assignee links below are set, not together with them: Department and
        // StaffUser reference each other (a department's default assignee is a staff row; a staff row's
        // department is a department row), and inserting both new rows in the same SaveChanges with both
        // FKs already populated gives EF Core's insert-ordering a cycle it cannot break — neither row
        // exists yet for the other to reference. Inserting everything with DefaultAssigneeStaffId still
        // null, then setting it and saving again, splits the cycle into two ordinary passes: the second
        // is pure updates against rows that already exist.
        await db.SaveChangesAsync(ct);

        // Auto-routing's second half: a category already picks the department; this is who a report
        // actually lands on the moment it gets there. Left unset for `green` and `frontDesk` — neither
        // has a staff account yet, and a report auto-assigned to nobody would be worse than one that
        // waits in the queue for a clerk to pick someone once those departments are staffed.
        infra.DefaultAssigneeStaffId = infraSup.Id;
        cleaning.DefaultAssigneeStaffId = cleanSup.Id;
        lighting.DefaultAssigneeStaffId = lightAgent.Id;
        water.DefaultAssigneeStaffId = waterSup.Id;

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Seeded municipality, {Departments} departments, {Categories} categories, {Staff} staff accounts.",
            6, 6, 5);

        // No reports are seeded. Reports now belong to real citizen accounts, and a demo full of
        // reports attributed to accounts nobody can log into is worse than an empty map: the
        // attribution, the 'my reports' screen and the one-confirmation-per-user rule would all be
        // demonstrating fiction. The map starts empty and fills with genuinely-submitted reports.
    }

    // NOTE: the purge of pre-accounts reports lives in the CitizenAccountsAndConfirmations migration,
    // where it runs exactly once. It must NOT live here: this method runs on every boot, and a
    // "delete all reports that have no owner" check here would delete every report every time the
    // app restarts, since the check can't distinguish legacy rows from freshly submitted ones.

    /// <summary>
    /// Category colour and icon are presentation config shared by all three clients, so they must be
    /// able to change without dropping operational data. This reconciles them on every boot — the same
    /// mechanism a real municipality would use to re-theme its taxonomy after a pilot.
    /// </summary>
    private static async Task SyncCategoryPresentationAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        // Validated with the dataviz palette checker: passes the lightness band, chroma floor, adjacent
        // CVD separation and contrast against BOTH the light and dark chart surfaces, so one palette
        // serves the map pins, the dashboard charts and the landing page.
        var palette = new Dictionary<string, (string Color, string Icon)>
        {
            ["roads"] = ("#E8590C", "road"),
            ["waste"] = ("#2F9E44", "trash"),
            ["lighting"] = ("#B08000", "bulb"),
            ["water"] = ("#339AF0", "droplet"),
            ["public_spaces"] = ("#845EF7", "tree"),
            ["other"] = ("#E64980", "alert")
        };

        var categories = await db.Categories.ToListAsync(ct);
        var changed = 0;

        foreach (var category in categories)
        {
            if (!palette.TryGetValue(category.Code, out var wanted)) continue;
            if (category.ColorHex == wanted.Color && category.Icon == wanted.Icon) continue;

            category.ColorHex = wanted.Color;
            category.Icon = wanted.Icon;
            changed++;
        }

        if (changed > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Reconciled presentation for {Count} categories.", changed);
        }
    }

    /// <summary>
    /// Backfills <see cref="Department.DefaultAssigneeStaffId"/> on a database that was already seeded
    /// before that field existed — this is what makes auto-assignment work on this machine's existing
    /// data without a reseed. Matched by email, the one identifier that does not change across reruns;
    /// only ever fills a currently-null value, so it can never overwrite a real admin decision later.
    /// </summary>
    private static async Task SyncDefaultAssigneesAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        var pairings = new Dictionary<string, string>
        {
            ["Infrastruktura"] = "i.meta@elbasan.gov.al",
            ["Shërbimet Publike"] = "b.dervishi@elbasan.gov.al",
            ["Ndriçimi"] = "g.rama@elbasan.gov.al",
            ["Ujësjellësi"] = "e.brahimi@ukelbasan.al",
        };

        var departments = await db.Departments
            .Where(d => d.DefaultAssigneeStaffId == null)
            .ToListAsync(ct);
        if (departments.Count == 0) return;

        var changed = 0;

        foreach (var department in departments)
        {
            if (!pairings.TryGetValue(department.ShortName, out var email)) continue;

            var staff = await db.StaffUsers.FirstOrDefaultAsync(u => u.Email == email, ct);
            if (staff is null) continue;

            department.DefaultAssigneeStaffId = staff.Id;
            changed++;
        }

        if (changed > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Backfilled default assignee for {Count} departments.", changed);
        }
    }

    private static Department Dept(Municipality m, string name, string shortName, string email, string phone, int sla) =>
        new()
        {
            MunicipalityId = m.Id, Municipality = m, Name = name, ShortName = shortName,
            Email = email, Phone = phone, SlaHours = sla
        };

    private static Category Cat(Municipality m, string code, string sq, string en, string desc,
        Department dept, string color, string icon, int sort) =>
        new()
        {
            MunicipalityId = m.Id, Municipality = m, Code = code, NameSq = sq, NameEn = en,
            Description = desc, DefaultDepartmentId = dept.Id, DefaultDepartment = dept,
            ColorHex = color, Icon = icon, SortOrder = sort
        };

    private static StaffUser Staff(Municipality m, Department? d, string email, string name,
        string title, StaffRole role, string hash) =>
        new()
        {
            MunicipalityId = m.Id, Municipality = m, DepartmentId = d?.Id, Department = d,
            Email = email, FullName = name, JobTitle = title, Role = role, PasswordHash = hash
        };

}
