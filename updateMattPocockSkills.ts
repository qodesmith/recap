// oxlint-disable no-console
// Pulls the latest Matt Pocock agent skills into the *calling* directory's
// `.claude/skills/`:
//
//   node tools/updateMattPocockSkills.ts   # run by `npm run update-matt-pocock-skills`
//
// `--copy` vendors the skill files rather than symlinking them into a shared
// cache, so what lands in `.claude/skills/` is what gets committed and reviewed.
// `-y` skips the interactive confirmation so this is safe to run unattended.

import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Also the `source` recorded in skills-lock.json, which the pruning below keys off.
const MATT_POCOCK_SKILLS_SOURCE = "mattpocock/skills";

// Arguments are passed as an array (no shell), so `*` reaches the CLI literally
// instead of being glob-expanded against the working directory.
const INSTALL_MATT_POCOCK_SKILLS_ARGS = [
	"skills@latest",
	"add",
	MATT_POCOCK_SKILLS_SOURCE,
	"--skill",
	"*",
	"--agent",
	"claude-code",
	"--copy",
	"-y",
];

// The skills CLI writes relative to its working directory, and the point of this
// script is to update whichever project invoked it — not the project this file
// happens to live in. `process.cwd()` is that caller's directory; passing it
// explicitly documents the intent (and keeps it correct if the script is ever
// resolved via an absolute path from elsewhere).
const mpSkillsInstallResult = spawnSync(
	"npx",
	INSTALL_MATT_POCOCK_SKILLS_ARGS,
	{
		cwd: process.cwd(),
		stdio: "inherit",
	},
);

if (mpSkillsInstallResult.error) {
	console.error(`Failed to run npx: ${mpSkillsInstallResult.error.message}`);
	process.exit(1);
}

// A signalled child has a null status; surface that as a failure rather than
// letting the script exit 0.
if (mpSkillsInstallResult.signal) {
	console.error(`npx terminated by signal ${mpSkillsInstallResult.signal}`);
	process.exit(1);
}

if (mpSkillsInstallResult.status !== 0)
	process.exit(mpSkillsInstallResult.status ?? 1);

// The upstream repo ships each skill's subagent definitions for both harnesses —
// `agents/claude-code.md` and `agents/openai.yaml`. `--agent claude-code` filters
// which *skills* are installed, not the files inside them, so the OpenAI variants
// come along for the ride. Strip them: they're noise in review, and for most
// skills `openai.yaml` is the only thing in `agents/`.
const skillsDir = join(process.cwd(), ".claude/skills");

// A missing `.claude/skills` isn't an error — it just means the CLI wrote
// nothing here, so there's nothing to clean up.
async function readSkillTree() {
	try {
		return await readdir(skillsDir, { recursive: true, withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

const openaiYamlFiles = (await readSkillTree()).filter(
	(entry) => entry.isFile() && entry.name === "openai.yaml",
);

// Safe to run these concurrently: a directory holds at most one `openai.yaml`,
// so no two of these tasks touch the same parent.
await Promise.all(
	openaiYamlFiles.map(async (entry) => {
		await rm(join(entry.parentPath, entry.name));

		// Only the immediate parent, and only when nothing else is left in it: this
		// undoes the empty `agents/` the deletion just created, nothing more.
		// `rmdir` over `rm({recursive: true})` so a directory that is somehow
		// non-empty by now throws instead of taking files with it.
		const siblings = await readdir(entry.parentPath);
		if (siblings.length === 0) await rmdir(entry.parentPath);
	}),
);

console.log(
	`Removed ${openaiYamlFiles.length} openai.yaml file(s) from ${skillsDir}`,
);

// `--skill '*'` takes everything the source publishes, including the skills it
// has retired under `skills/deprecated/`. Drop them: both the installed files and
// the lockfile entry, so the next run doesn't treat them as still-managed.
//
// Read rather than `import ... with {type: 'json'}`: an import resolves against
// *this file*, which is the wrong project whenever the script is invoked from
// elsewhere, and it would be a snapshot taken before the CLI rewrote the lockfile
// moments ago in this same process.
interface SkillsLock {
	skills?: Record<string, { source?: string; skillPath?: string }>;
}

const lockfile = join(process.cwd(), "skills-lock.json");
const skillsLockContents = JSON.parse(
	await readFile(lockfile, "utf8"),
) as SkillsLock;

// Scoped to this source: other sources' `deprecated` paths are not ours to prune.
const deprecatedSkills = Object.entries(skillsLockContents.skills ?? {}).filter(
	([, entry]) =>
		entry.source === MATT_POCOCK_SKILLS_SOURCE &&
		entry.skillPath?.startsWith("skills/deprecated/"),
);

// `force` because the entry can outlive its directory — a previous run (or a
// hand edit) may have removed the files already.
await Promise.all(
	deprecatedSkills.map(async ([name]) => {
		await rm(join(skillsDir, name), { recursive: true, force: true });
	}),
);

if (deprecatedSkills.length > 0) {
	for (const [name] of deprecatedSkills)
		delete skillsLockContents.skills?.[name];
	await writeFile(lockfile, `${JSON.stringify(skillsLockContents, null, 2)}\n`);
}

console.log(
	`Removed ${deprecatedSkills.length} deprecated skill(s): ${deprecatedSkills.map(([name]) => name).join(", ") || "none"}`,
);
