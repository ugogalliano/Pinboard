using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PostIt.Api.Migrations
{
    /// <inheritdoc />
    public partial class AlterNoteContentMaxLengthTo1000 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Pre-deploy check: this ALTER aborts if any Content row exceeds the
            // new limit (rows of length 1001-2000; none expected, the application
            // limit was already 1000):
            //   SELECT count(*) FROM "Notes" WHERE length("Content") > 1000;
            // Email normalisation backfill lives in NormalizeUserEmailsToLowercase.
            migrationBuilder.AlterColumn<string>(
                name: "Content",
                schema: "public",
                table: "Notes",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Content",
                schema: "public",
                table: "Notes",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);
        }
    }
}
