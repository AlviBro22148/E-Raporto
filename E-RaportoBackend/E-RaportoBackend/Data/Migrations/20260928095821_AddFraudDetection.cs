using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace E_RaportoBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFraudDetection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "photo_reuse_flag");

            migrationBuilder.CreateTable(
                name: "fraud_flag",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    related_report_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    reasoning = table.Column<string>(type: "text", nullable: false),
                    score = table.Column<double>(type: "double precision", nullable: true),
                    review_status = table.Column<int>(type: "integer", nullable: false),
                    reviewed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    raised_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fraud_flag", x => x.id);
                    table.ForeignKey(
                        name: "FK_fraud_flag_report_related_report_id",
                        column: x => x.related_report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_fraud_flag_report_report_id",
                        column: x => x.report_id,
                        principalTable: "report",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_fraud_flag_staff_user_raised_by_staff_id",
                        column: x => x.raised_by_staff_id,
                        principalTable: "staff_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_fraud_flag_staff_user_reviewed_by_staff_id",
                        column: x => x.reviewed_by_staff_id,
                        principalTable: "staff_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_kind",
                table: "fraud_flag",
                column: "kind");

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_raised_by_staff_id",
                table: "fraud_flag",
                column: "raised_by_staff_id");

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_related_report_id",
                table: "fraud_flag",
                column: "related_report_id");

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_report_id_related_report_id_kind",
                table: "fraud_flag",
                columns: new[] { "report_id", "related_report_id", "kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_review_status",
                table: "fraud_flag",
                column: "review_status");

            migrationBuilder.CreateIndex(
                name: "IX_fraud_flag_reviewed_by_staff_id",
                table: "fraud_flag",
                column: "reviewed_by_staff_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fraud_flag");

            migrationBuilder.CreateTable(
                name: "photo_reuse_flag",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    matched_report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    report_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    hamming_distance = table.Column<int>(type: "integer", nullable: false),
                    review_status = table.Column<int>(type: "integer", nullable: false),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reviewed_by_staff_id = table.Column<Guid>(type: "uuid", nullable: true)
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
        }
    }
}
