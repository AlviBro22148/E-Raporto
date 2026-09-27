using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace E_RaportoBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCommit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "municipality",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    ref_prefix = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    center_lat = table.Column<double>(type: "double precision", nullable: false),
                    center_lng = table.Column<double>(type: "double precision", nullable: false),
                    default_map_radius_m = table.Column<int>(type: "integer", nullable: false),
                    timezone = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipality", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "citizen_user",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    full_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    pseudonym = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    push_token = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    push_token_updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    preferred_locale = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_citizen_user", x => x.id);
                    table.ForeignKey(
                        name: "FK_citizen_user_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "category",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name_sq = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    name_en = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    default_department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    color_hex = table.Column<string>(type: "character varying(9)", maxLength: 9, nullable: false),
                    icon = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_category", x => x.id);
                    table.ForeignKey(
                        name: "FK_category_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "citizen_notification",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    citizen_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    title_en = table.Column<string>(type: "text", nullable: false),
                    body_en = table.Column<string>(type: "text", nullable: false),
                    is_read = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_citizen_notification", x => x.id);
                    table.ForeignKey(
                        name: "FK_citizen_notification_citizen_user_citizen_user_id",
                        column: x => x.citizen_user_id,
                        principalTable: "citizen_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "department",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    short_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    email = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    sla_hours = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    default_assignee_staff_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_department", x => x.id);
                    table.ForeignKey(
                        name: "FK_department_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "staff_user",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    email = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    full_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    job_title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    role = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_staff_user", x => x.id);
                    table.ForeignKey(
                        name: "FK_staff_user_department_department_id",
                        column: x => x.department_id,
                        principalTable: "department",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_staff_user_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "systemic_pattern",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    centroid_lat = table.Column<double>(type: "double precision", nullable: false),
                    centroid_lng = table.Column<double>(type: "double precision", nullable: false),
                    member_count = table.Column<int>(type: "integer", nullable: false),
                    ai_summary_sq = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: true),
                    ai_connection_type = table.Column<int>(type: "integer", nullable: true),
                    ai_confidence = table.Column<double>(type: "double precision", nullable: true),
                    ai_model = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    review_status = table.Column<int>(type: "integer", nullable: false),
                    reviewed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    detected_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_report_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_systemic_pattern", x => x.id);
                    table.ForeignKey(
                        name: "FK_systemic_pattern_category_category_id",
                        column: x => x.category_id,
                        principalTable: "category",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_systemic_pattern_department_department_id",
                        column: x => x.department_id,
                        principalTable: "department",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_systemic_pattern_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "report",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    public_ref = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    municipality_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    title_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    description_sq = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    description_en = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    category_id = table.Column<Guid>(type: "uuid", nullable: true),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false),
                    priority = table.Column<int>(type: "integer", nullable: false),
                    latitude = table.Column<double>(type: "double precision", nullable: false),
                    longitude = table.Column<double>(type: "double precision", nullable: false),
                    address_text = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    reporter_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reporter_label = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    confirmation_count = table.Column<int>(type: "integer", nullable: false),
                    assigned_to_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    merged_into_report_id = table.Column<Guid>(type: "uuid", nullable: true),
                    systemic_pattern_id = table.Column<Guid>(type: "uuid", nullable: true),
                    ai_suggested_category_id = table.Column<Guid>(type: "uuid", nullable: true),
                    ai_suggested_priority = table.Column<int>(type: "integer", nullable: true),
                    ai_confidence = table.Column<double>(type: "double precision", nullable: true),
                    ai_reasoning = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ai_reasoning_en = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ai_summary_sq = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ai_model = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    classification_source = table.Column<int>(type: "integer", nullable: false),
                    is_category_overridden = table.Column<bool>(type: "boolean", nullable: false),
                    overridden_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    override_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    acknowledged_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    assigned_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report", x => x.id);
                    table.ForeignKey(
                        name: "FK_report_category_category_id",
                        column: x => x.category_id,
                        principalTable: "category",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_report_citizen_user_reporter_user_id",
                        column: x => x.reporter_user_id,
                        principalTable: "citizen_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_report_department_department_id",
                        column: x => x.department_id,
                        principalTable: "department",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_report_municipality_municipality_id",
                        column: x => x.municipality_id,
                        principalTable: "municipality",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_report_report_merged_into_report_id",
                        column: x => x.merged_into_report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_report_staff_user_assigned_to_staff_id",
                        column: x => x.assigned_to_staff_id,
                        principalTable: "staff_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_report_systemic_pattern_systemic_pattern_id",
                        column: x => x.systemic_pattern_id,
                        principalTable: "systemic_pattern",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "duplicate_candidate",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    candidate_report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    distance_meters = table.Column<double>(type: "double precision", nullable: false),
                    text_similarity = table.Column<double>(type: "double precision", nullable: false),
                    score = table.Column<double>(type: "double precision", nullable: false),
                    method = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    review_status = table.Column<int>(type: "integer", nullable: false),
                    reviewed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_duplicate_candidate", x => x.id);
                    table.ForeignKey(
                        name: "FK_duplicate_candidate_report_candidate_report_id",
                        column: x => x.candidate_report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_duplicate_candidate_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "photo_reuse_flag",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    matched_report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    hamming_distance = table.Column<int>(type: "integer", nullable: false),
                    review_status = table.Column<int>(type: "integer", nullable: false),
                    reviewed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_photo_reuse_flag", x => x.id);
                    table.ForeignKey(
                        name: "FK_photo_reuse_flag_report_matched_report_id",
                        column: x => x.matched_report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_photo_reuse_flag_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "report_confirmation",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    citizen_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_confirmation", x => x.id);
                    table.ForeignKey(
                        name: "FK_report_confirmation_citizen_user_citizen_user_id",
                        column: x => x.citizen_user_id,
                        principalTable: "citizen_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_report_confirmation_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "report_photo",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    storage_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    content_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    perceptual_hash = table.Column<long>(type: "bigint", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_photo", x => x.id);
                    table.ForeignKey(
                        name: "FK_report_photo_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "report_status_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_status = table.Column<int>(type: "integer", nullable: true),
                    to_status = table.Column<int>(type: "integer", nullable: false),
                    note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    note_en = table.Column<string>(type: "text", nullable: true),
                    changed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    changed_by_label = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_status_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_report_status_history_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "resolution_verification",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    citizen_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    outcome = table.Column<int>(type: "integer", nullable: false),
                    comment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    photo_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    distance_meters = table.Column<double>(type: "double precision", nullable: true),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_resolution_verification", x => x.id);
                    table.ForeignKey(
                        name: "FK_resolution_verification_citizen_user_citizen_user_id",
                        column: x => x.citizen_user_id,
                        principalTable: "citizen_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_resolution_verification_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_category_default_department_id",
                table: "category",
                column: "default_department_id");

            migrationBuilder.CreateIndex(
                name: "IX_category_municipality_id_code",
                table: "category",
                columns: new[] { "municipality_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_citizen_notification_citizen_user_id_is_read",
                table: "citizen_notification",
                columns: new[] { "citizen_user_id", "is_read" });

            migrationBuilder.CreateIndex(
                name: "IX_citizen_notification_report_id",
                table: "citizen_notification",
                column: "report_id");

            migrationBuilder.CreateIndex(
                name: "IX_citizen_user_email",
                table: "citizen_user",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_citizen_user_municipality_id",
                table: "citizen_user",
                column: "municipality_id");

            migrationBuilder.CreateIndex(
                name: "IX_citizen_user_pseudonym",
                table: "citizen_user",
                column: "pseudonym",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_department_default_assignee_staff_id",
                table: "department",
                column: "default_assignee_staff_id");

            migrationBuilder.CreateIndex(
                name: "IX_department_municipality_id",
                table: "department",
                column: "municipality_id");

            migrationBuilder.CreateIndex(
                name: "IX_duplicate_candidate_candidate_report_id",
                table: "duplicate_candidate",
                column: "candidate_report_id");

            migrationBuilder.CreateIndex(
                name: "IX_duplicate_candidate_report_id_candidate_report_id",
                table: "duplicate_candidate",
                columns: new[] { "report_id", "candidate_report_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_duplicate_candidate_review_status",
                table: "duplicate_candidate",
                column: "review_status");

            migrationBuilder.CreateIndex(
                name: "IX_municipality_slug",
                table: "municipality",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_photo_reuse_flag_matched_report_id",
                table: "photo_reuse_flag",
                column: "matched_report_id");

            migrationBuilder.CreateIndex(
                name: "IX_photo_reuse_flag_report_id_matched_report_id",
                table: "photo_reuse_flag",
                columns: new[] { "report_id", "matched_report_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_photo_reuse_flag_review_status",
                table: "photo_reuse_flag",
                column: "review_status");

            migrationBuilder.CreateIndex(
                name: "IX_report_assigned_to_staff_id",
                table: "report",
                column: "assigned_to_staff_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_category_id",
                table: "report",
                column: "category_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_created_at",
                table: "report",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "IX_report_department_id",
                table: "report",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_latitude_longitude",
                table: "report",
                columns: new[] { "latitude", "longitude" });

            migrationBuilder.CreateIndex(
                name: "IX_report_merged_into_report_id",
                table: "report",
                column: "merged_into_report_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_municipality_id_status",
                table: "report",
                columns: new[] { "municipality_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_report_public_ref",
                table: "report",
                column: "public_ref",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_report_reporter_user_id",
                table: "report",
                column: "reporter_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_systemic_pattern_id",
                table: "report",
                column: "systemic_pattern_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_confirmation_citizen_user_id",
                table: "report_confirmation",
                column: "citizen_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_confirmation_report_id_citizen_user_id",
                table: "report_confirmation",
                columns: new[] { "report_id", "citizen_user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_report_photo_report_id",
                table: "report_photo",
                column: "report_id");

            migrationBuilder.CreateIndex(
                name: "IX_report_status_history_report_id_created_at",
                table: "report_status_history",
                columns: new[] { "report_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_resolution_verification_citizen_user_id",
                table: "resolution_verification",
                column: "citizen_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_resolution_verification_report_id_resolved_at",
                table: "resolution_verification",
                columns: new[] { "report_id", "resolved_at" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_staff_user_department_id",
                table: "staff_user",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_staff_user_email",
                table: "staff_user",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_staff_user_municipality_id",
                table: "staff_user",
                column: "municipality_id");

            migrationBuilder.CreateIndex(
                name: "IX_systemic_pattern_category_id",
                table: "systemic_pattern",
                column: "category_id");

            migrationBuilder.CreateIndex(
                name: "IX_systemic_pattern_department_id",
                table: "systemic_pattern",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_systemic_pattern_municipality_id_category_id_review_status",
                table: "systemic_pattern",
                columns: new[] { "municipality_id", "category_id", "review_status" });

            migrationBuilder.CreateIndex(
                name: "IX_systemic_pattern_review_status",
                table: "systemic_pattern",
                column: "review_status");

            migrationBuilder.AddForeignKey(
                name: "FK_category_department_default_department_id",
                table: "category",
                column: "default_department_id",
                principalTable: "department",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_citizen_notification_report_report_id",
                table: "citizen_notification",
                column: "report_id",
                principalTable: "report",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_department_staff_user_default_assignee_staff_id",
                table: "department",
                column: "default_assignee_staff_id",
                principalTable: "staff_user",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_staff_user_department_department_id",
                table: "staff_user");

            migrationBuilder.DropTable(
                name: "citizen_notification");

            migrationBuilder.DropTable(
                name: "duplicate_candidate");

            migrationBuilder.DropTable(
                name: "photo_reuse_flag");

            migrationBuilder.DropTable(
                name: "report_confirmation");

            migrationBuilder.DropTable(
                name: "report_photo");

            migrationBuilder.DropTable(
                name: "report_status_history");

            migrationBuilder.DropTable(
                name: "resolution_verification");

            migrationBuilder.DropTable(
                name: "report");

            migrationBuilder.DropTable(
                name: "citizen_user");

            migrationBuilder.DropTable(
                name: "systemic_pattern");

            migrationBuilder.DropTable(
                name: "category");

            migrationBuilder.DropTable(
                name: "department");

            migrationBuilder.DropTable(
                name: "staff_user");

            migrationBuilder.DropTable(
                name: "municipality");
        }
    }
}
