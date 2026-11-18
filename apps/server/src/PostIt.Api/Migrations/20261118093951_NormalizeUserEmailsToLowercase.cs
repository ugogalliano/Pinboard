using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PostIt.Api.Migrations
{
    /// <inheritdoc />
    /// <remarks>
    /// Data-only migration: backfills stored emails to their canonical
    /// lowercase form, aligning existing rows with the registration/login
    /// normalisation (no schema changes; the model diff is intentionally empty).
    /// Rollout ordering: this migration must be applied WITH or BEFORE the app
    /// deployment that reads normalized emails, because login and member
    /// lookups now query lowercased values.
    /// Pre-flight checks: the note-content-length check
    /// (SELECT count(*) FROM "Notes" WHERE length("Content") > 1000) belongs to
    /// the other pending migration, AlterNoteContentMaxLengthTo1000. The
    /// email case-collision check below is enforced inside this migration and
    /// aborts it when duplicates are found.
    /// </remarks>
    public partial class NormalizeUserEmailsToLowercase : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Detect collisions first under the SAME normalization the UPDATE
            // applies (lower(trim(...))): if two rows collapse to one canonical
            // email — by case or surrounding whitespace — the UPDATE would
            // violate the unique index on Users.Email. Abort with a clear
            // message instead of a raw 23505 error so the duplicates can be
            // resolved manually.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    collision text;
BEGIN
    SELECT lower(trim(""Email"")) INTO collision
    FROM ""Users""
    GROUP BY lower(trim(""Email""))
    HAVING count(*) > 1
    LIMIT 1;

    IF collision IS NOT NULL THEN
        RAISE EXCEPTION 'email case-collision detected for %; resolve manually before migrating', collision;
    END IF;

    UPDATE ""Users"" SET ""Email"" = lower(trim(""Email""));
END
$$;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // No-op: lowercasing emails is intentionally not reversible
            // (the original casing is not retained anywhere).
        }
    }
}
