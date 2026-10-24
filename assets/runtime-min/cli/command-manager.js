import { execFile, spawn } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, readFile, readlink, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
//#region ../../packages/util/atomic-write/lib/index.js
/**
* Zero-dependency atomic file replacement and writer coordination.
* `writeFileAtomic` writes a random-suffix sibling with exclusive create and
* the caller's permission bits, then renames it over the target, so readers
* observe either the old or the new complete content and a replaced file ends
* up with exactly the stated mode. `withFileLock` serializes cross-process
* writers of one file through a `wx`-created `<file>.lock` sibling, so a
* read-modify-write cycle can never resurrect a state another writer just
* replaced; readers stay lock-free because the rename commit is atomic. A lock
* whose recorded holder process no longer exists is taken over.
* @module @deepseek-ai/dsh-atomic-write
*/
const WINDOWS_TRANSIENT_RENAME_ERRORS = new Set([
	"EACCES",
	"EBUSY",
	"EPERM"
]);
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
const WINDOWS_RENAME_RETRY_MAX_MS = 200;
const WINDOWS_RENAME_RETRY_LIMIT = 8;
/** Whether Windows reported temporary interference with an atomic replacement. */
function isTransientWindowsRenameError(error) {
	if (process.platform !== "win32") return false;
	return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
/** Replace the target after bounded retries for transient Windows interference. */
async function renameAtomicTemp(temp, filename) {
	let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
	for (let retries = 0;; retries += 1) {
		try {
			await rename(temp, filename);
			return;
		} catch (error) {
			if (!isTransientWindowsRenameError(error)) throw error;
			if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
	}
}
/**
* Replace `filename` with `content` in one atomic step, creating parent
* directories. The content is first written to a random-suffix sibling opened
* with exclusive create (`wx`): the open refuses to follow a symlink planted
* at the temp path, and the fresh inode carries `options.mode` through the
* rename, so replacing a wider-permission file narrows it without a chmod
* race. The rename also replaces a symlinked target itself instead of writing
* through to its referent, and the same-directory sibling keeps the rename on
* one filesystem. Windows replacement retries transient `EACCES`, `EBUSY`,
* and `EPERM` failures for a bounded interval while the complete temp file
* remains the rename source. On any remaining failure the temp file is
* removed and the failure rethrown. Crash durability (fsync) is out of scope.
* @param filename - final path receiving the content.
* @param content - complete next file content.
* @param options - permission bits for the replacement inode.
*/
async function writeFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await renameAtomicTemp(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
/** Whether an exclusive create found an existing lock. */
async function isLockContention(error, lockPath) {
	const code = error?.code;
	if (code === "EEXIST") return true;
	if (code !== "EPERM") return false;
	try {
		await lstat(lockPath);
		return true;
	} catch {
		return false;
	}
}
/** Whether the holder a `<pid>\n` record names is proven gone: a signal probe finds no such process. */
function holderExited(record) {
	if (!/^\d+\n$/.test(record)) return false;
	const pid = Number(record.trim());
	if (pid === 0 || pid > 2147483647) return false;
	if (pid === process.pid) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return error.code === "ESRCH";
	}
}
/** The lock file's content, or undefined when it cannot be read. */
async function readLockRecord(lockPath) {
	try {
		return await readFile(lockPath, "utf8");
	} catch (error) {
		return;
	}
}
/**
* Remove the lock when its recorded holder exited. Contenders that read the
* same record serialize on a claim file named after it. Under the claim, the
* claimant re-reads the lock and probes its PID again, and removes it only
* when it still holds that record and that PID is still gone: the record's
* holder can no longer release it, and no other contender can remove it
* without the claim, so a removal never deletes a lock another contender
* acquired after the dead holder's, including one whose holder reused the PID.
* @returns Whether this call removed the dead holder's lock.
*/
async function takeOverExitedLock(lockPath) {
	const record = await readLockRecord(lockPath);
	if (record === void 0 || !holderExited(record)) return false;
	const claim = `${lockPath}.takeover-${createHash("sha256").update(record).digest("hex").slice(0, 16)}`;
	try {
		await writeFile(claim, `${process.pid}\n`, {
			mode: 384,
			flag: "wx"
		});
	} catch (error) {
		const code = error.code;
		if (code === "EEXIST" || code === "EPERM") return false;
		throw error;
	}
	try {
		if (await readLockRecord(lockPath) !== record || !holderExited(record)) return false;
		try {
			await rm(lockPath, { force: true });
		} catch (error) {
			return false;
		}
		return true;
	} finally {
		await rm(claim, { force: true }).catch((error) => {});
	}
}
/**
* Retry cadence for a contended lock. These stay robustness invariants of the
* cross-process write protocol rather than deployment tunables: they govern how
* often a contender asks, which no caller has a reason to vary.
*/
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
/**
* How long a contender waits when the caller states no limit — sized for the
* render-and-rename cycle every call site had when this package was written.
* Expiry fails the contender rather than guessing whether the existing lock
* still has an owner. How long is *worth* waiting is a property of the
* operation the lock holder runs, which is why {@link FileLockOptions.waitMs}
* exists; the value here is the floor for an operation that does file work
* alone.
*/
const DEFAULT_LOCK_WAIT_MS = 2e3;
/**
* Hold the cross-process writer lock for `filename` around one operation. The
* lock is a `wx`-created sibling (`<filename>.lock`); paired with the
* rename-based commit of {@link writeFileAtomic}, readers stay lock-free and
* only writers contend. `EEXIST` is contention directly; an `EPERM` is
* contention only when a fresh `lstat` confirms the lock path exists, covering
* Windows exclusive-create behavior. Windows retries one unconfirmed EPERM
* because the holder can release before the probe; a repeated unconfirmed
* permission error is rethrown. The lock records its holder's PID. A contender
* removes the lock and retries at once when no process with that PID exists
* (`ESRCH`); any other lock, including one whose holder exists under another
* user (`EPERM`) or whose record is incomplete, is waited for. Contention backs
* off exponentially and times out after the deadline. A holder whose PID a
* live process reused keeps its lock until an operator removes it. Takeover
* proves only that the recorded process exited: an operation that starts other
* writers must stop them with it or leave its successor a way to find them.
* PIDs are compared on the contender's host, so writers on other hosts or in
* other PID namespaces sharing the file are unsupported and could both hold
* the lock. The parent directory must exist.
* @param filename - the file whose writers this lock serializes.
* @param operation - the read-render-commit cycle to run while holding the lock.
* @param options - acquisition options; omitted waits {@link DEFAULT_LOCK_WAIT_MS}.
* @returns the operation's result; the lock releases on both outcomes.
*/
async function withFileLock(filename, operation, options) {
	const lockPath = `${filename}.lock`;
	const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS);
	let delay = LOCK_RETRY_INITIAL_MS;
	let retriedUnconfirmedPermissionError = false;
	for (;;) {
		options?.signal?.throwIfAborted();
		try {
			await writeFile(lockPath, `${process.pid}\n`, {
				mode: 384,
				flag: "wx"
			});
			break;
		} catch (error) {
			if (!await isLockContention(error, lockPath)) {
				if (process.platform !== "win32" || error?.code !== "EPERM" || retriedUnconfirmedPermissionError) throw error;
				retriedUnconfirmedPermissionError = true;
			} else if (await takeOverExitedLock(lockPath)) continue;
		}
		if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);
		await setTimeout$1(delay, void 0, { signal: options?.signal });
		delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
	}
	try {
		options?.signal?.throwIfAborted();
		return await operation();
	} finally {
		await rm(lockPath, { force: true });
	}
}
//#endregion
//#region lib/types/command-installation.js
/** Reversible command-link ownership; operations never follow or overwrite a changed command entry. */
/** A declined stale operation or a command entry outside this installer's ownership. */
var CommandInstallationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
function digest(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function receiptPath(options) {
	return join(dirname(options.destination), ".dsh-desktop-command.json");
}
async function readEntry(path) {
	let info;
	try {
		info = await lstat(path, { bigint: true });
	} catch (error) {
		if (error.code === "ENOENT") return {
			kind: "missing",
			fingerprint: digest("missing")
		};
		throw error;
	}
	const fields = [
		info.dev,
		info.ino,
		info.mode,
		info.uid,
		info.gid,
		info.size,
		info.mtimeNs
	].map(String);
	if (info.isSymbolicLink()) {
		const target = await readlink(path);
		return {
			kind: "symlink",
			fingerprint: digest({
				kind: "symlink",
				fields,
				target
			}),
			target
		};
	}
	const kind = info.isFile() ? "file" : "unsupported";
	return {
		kind,
		fingerprint: digest({
			kind,
			fields
		})
	};
}
async function readReceipt(options) {
	const path = receiptPath(options);
	let info;
	try {
		info = await lstat(path);
	} catch (error) {
		if (error.code === "ENOENT") return void 0;
		throw error;
	}
	if (!info.isFile() || info.size > 8192) throw new CommandInstallationError("EOWNERSHIP", "Invalid command ownership record.");
	let value;
	try {
		value = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		throw new CommandInstallationError("EOWNERSHIP", "Invalid command ownership record.");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CommandInstallationError("EOWNERSHIP", "Invalid command ownership record.");
	const record = value;
	if (record.schemaVersion !== 1 || typeof record.launcher !== "string" || !isAbsolute(record.launcher) || typeof record.installedFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(record.installedFingerprint)) throw new CommandInstallationError("EOWNERSHIP", "Invalid command ownership record.");
	let backup;
	if (record.backup !== void 0) {
		if (typeof record.backup !== "object" || record.backup === null) throw new CommandInstallationError("EOWNERSHIP", "Invalid command backup record.");
		const candidate = record.backup;
		if (typeof candidate.name !== "string" || !/^\.dsh-command-backup-[a-f0-9-]{36}$/u.test(candidate.name) || typeof candidate.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.fingerprint)) throw new CommandInstallationError("EOWNERSHIP", "Invalid command backup record.");
		backup = {
			name: candidate.name,
			fingerprint: candidate.fingerprint
		};
	}
	return {
		schemaVersion: 1,
		launcher: record.launcher,
		installedFingerprint: record.installedFingerprint,
		...backup === void 0 ? {} : { backup }
	};
}
async function available(path) {
	try {
		await access(path, constants.X_OK);
		return (await stat(path)).isFile();
	} catch (error) {
		if (["ENOENT", "EACCES"].includes(error.code ?? "")) return false;
		throw error;
	}
}
async function readSnapshot(options) {
	const entry = await readEntry(options.destination);
	const receipt = await readReceipt(options);
	return {
		entry,
		receipt,
		state: {
			fingerprint: digest({
				entry: entry.fingerprint,
				receipt
			}),
			destination: options.destination,
			launcher: options.launcher,
			kind: entry.kind,
			managed: receipt !== void 0 && entry.kind === "symlink" && entry.target === receipt.launcher && entry.fingerprint === receipt.installedFingerprint,
			available: await available(options.destination),
			...entry.kind === "symlink" ? { target: entry.target } : {},
			...receipt?.backup === void 0 ? {} : { backup: join(dirname(options.destination), receipt.backup.name) }
		}
	};
}
/**
* Read the command and receipt without changing either.
* @param options - Fixed command destination and current installed launcher.
* @returns A fingerprint to bind a later user decision to the observed entries.
*/
async function inspectFileCommand(options) {
	return (await readSnapshot(options)).state;
}
async function restoreEntry(options, source, destination, expected) {
	const entry = await readEntry(source);
	if (expected !== void 0 && entry.fingerprint !== expected) throw new CommandInstallationError("EOWNERSHIP", "Command backup changed.");
	if (entry.kind !== "symlink" && entry.kind !== "file") throw new CommandInstallationError("EOWNERSHIP", "Command backup is unavailable.");
	if (expected !== void 0) {
		const claimed = await withdraw(options, source, entry);
		if (claimed === void 0) throw new CommandInstallationError("EOWNERSHIP", "Command backup is unavailable.");
		try {
			await restoreEntry(options, claimed, destination);
		} catch (error) {
			try {
				await restoreEntry(options, claimed, source);
			} catch (restoreError) {
				throw new AggregateError([error, restoreError], "The command backup is preserved at " + claimed);
			}
			throw error;
		}
		return;
	}
	await linkEntry(options, source, destination);
	if ((await readEntry(destination)).fingerprint !== entry.fingerprint) throw new CommandInstallationError("EOWNERSHIP", "Command backup changed during restoration.");
	await unlink(source);
}
async function linkEntry(options, source, destination) {
	if (process.platform === "darwin") await promisify(execFile)(options.linkHelper, [source, destination]);
	else await link(source, destination);
}
async function withdraw(options, destination, expected) {
	if (expected.kind === "missing") return void 0;
	if (expected.kind === "unsupported") throw new CommandInstallationError("EUNSUPPORTED", "The command path is not a file or symbolic link.");
	const path = join(dirname(destination), ".dsh-command-backup-" + randomUUID());
	await rename(destination, path);
	if ((await readEntry(path)).fingerprint !== expected.fingerprint) {
		try {
			await restoreEntry(options, path, destination);
		} catch (error) {
			throw new AggregateError([error], "The command changed; its entry is preserved at " + path);
		}
		throw new CommandInstallationError("ESTALE", "The command changed after confirmation.");
	}
	return path;
}
/**
* Install or repair a link, keeping the previous launcher available for removal.
* @param options - Fixed command destination and current installed launcher.
* @param expected - Fingerprint displayed in the user's confirmation.
* @returns Updated state and any older backup preserved after an external command replacement.
*/
async function installFileCommand(options, expected) {
	await mkdir(dirname(options.destination), { recursive: true });
	return withFileLock(receiptPath(options), async () => {
		const { state, entry, receipt } = await readSnapshot(options);
		if (state.fingerprint !== expected) throw new CommandInstallationError("ESTALE", "The command changed after confirmation.");
		if (!await available(options.launcher)) throw new CommandInstallationError("ENOENT", "The installed launcher is unavailable.");
		const moved = await withdraw(options, options.destination, entry);
		const pending = join(dirname(options.destination), ".dsh-command-new-" + randomUUID());
		let created;
		try {
			await symlink(options.launcher, pending);
			created = await readEntry(pending);
			await linkEntry(options, pending, options.destination);
			const backup = state.managed || moved === void 0 ? receipt?.backup : {
				name: basename(moved),
				fingerprint: entry.fingerprint
			};
			const next = {
				schemaVersion: 1,
				launcher: options.launcher,
				installedFingerprint: created.fingerprint,
				...backup === void 0 ? {} : { backup }
			};
			await writeFileAtomic(receiptPath(options), JSON.stringify(next) + "\n", { mode: 420 });
		} catch (error) {
			if (created !== void 0 && (await readEntry(options.destination)).fingerprint === created.fingerprint) {
				const rollback = await withdraw(options, options.destination, created);
				if (rollback !== void 0) await unlink(rollback);
			}
			if (moved !== void 0) try {
				await restoreEntry(options, moved, options.destination, entry.fingerprint);
			} catch (restoreError) {
				throw new AggregateError([error, restoreError], "The previous command is preserved at " + moved);
			}
			throw error;
		} finally {
			try {
				await unlink(pending);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		if (state.managed && moved !== void 0) await unlink(moved);
		const result = await inspectFileCommand(options);
		const previousBackup = receipt?.backup === void 0 ? void 0 : join(dirname(options.destination), receipt.backup.name);
		return previousBackup !== void 0 && !state.managed && moved !== void 0 && (await readEntry(previousBackup)).kind !== "missing" ? {
			...result,
			preservedBackup: previousBackup
		} : result;
	}, { waitMs: 5e3 });
}
/**
* Remove only a recorded Desktop link and restore its unchanged previous entry.
* @param options - Fixed command destination and current installed launcher.
* @param expected - Fingerprint displayed when removal was requested.
* @returns State after removal; an externally replaced command remains untouched.
*/
async function removeFileCommand(options, expected) {
	return withFileLock(receiptPath(options), async () => {
		const { state, entry, receipt } = await readSnapshot(options);
		if (state.fingerprint !== expected) throw new CommandInstallationError("ESTALE", "The command changed after confirmation.");
		if (receipt === void 0) return state;
		const backup = receipt.backup === void 0 ? void 0 : join(dirname(options.destination), receipt.backup.name);
		if (state.managed && backup !== void 0 && receipt.backup !== void 0 && (await readEntry(backup)).fingerprint !== receipt.backup.fingerprint) throw new CommandInstallationError("EOWNERSHIP", "The previous command backup changed or is missing.");
		if (state.managed) {
			const removed = await withdraw(options, options.destination, entry);
			try {
				if (backup !== void 0) await restoreEntry(options, backup, options.destination, receipt.backup?.fingerprint);
				await unlink(receiptPath(options));
			} catch (error) {
				if (removed !== void 0) try {
					if ((await readEntry(options.destination)).kind === "missing") await restoreEntry(options, removed, options.destination, entry.fingerprint);
					else await unlink(removed);
				} catch (restoreError) {
					throw new AggregateError([error, restoreError], "The Desktop command link is preserved at " + removed);
				}
				throw error;
			}
			if (removed !== void 0) await unlink(removed);
		} else await unlink(receiptPath(options));
		const result = await inspectFileCommand(options);
		return !state.managed && backup !== void 0 && (await readEntry(backup)).kind !== "missing" ? {
			...result,
			preservedBackup: backup
		} : result;
	}, { waitMs: 5e3 });
}
//#endregion
//#region lib/types/command-manager-entry.js
/** Private command-management worker; macOS mutation targets are fixed before elevation. */
const [operation, expected] = process.argv.slice(2);
const fingerprint = expected ?? "";
const resources = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform === "darwin") process.umask(18);
try {
	if (![
		"inspect",
		"install",
		"remove"
	].includes(operation ?? "")) throw new CommandInstallationError("EINVAL", "Invalid command-management operation.");
	if (operation !== "inspect" && !/^[a-f0-9]{64}$/u.test(fingerprint)) throw new CommandInstallationError("EINVAL", "Missing command confirmation.");
	if (process.platform === "darwin") {
		const options = {
			destination: "/usr/local/bin/dsh",
			launcher: join(resources, "runtime", "cli", "bin", "dsh"),
			linkHelper: join(resources, "runtime", "cli", "link-entry")
		};
		const state = operation === "inspect" ? await inspectFileCommand(options) : operation === "install" ? await installFileCommand(options, fingerprint) : await removeFileCommand(options, fingerprint);
		process.stdout.write(JSON.stringify({
			ok: true,
			state
		}) + "\n");
	} else if (process.platform === "win32") {
		const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
		if (systemRoot === void 0) throw new CommandInstallationError("ENOENT", "Windows system directory is unavailable.");
		const child = spawn(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			join(resources, "runtime", "cli", "command-path.ps1")
		], {
			stdio: [
				"pipe",
				"pipe",
				"inherit"
			],
			windowsHide: true
		});
		child.stdout.pipe(process.stdout);
		const exited = new Promise((accept, reject) => {
			child.once("error", reject);
			child.once("close", accept);
		});
		child.stdin.end(JSON.stringify({
			operation,
			expected,
			directory: join(resources, "runtime", "cli", "bin")
		}));
		process.exitCode = await exited ?? 1;
	} else throw new CommandInstallationError("EUNSUPPORTED", "Command installation is supported on macOS and Windows.");
} catch (error) {
	process.stdout.write(JSON.stringify({
		ok: false,
		code: error instanceof CommandInstallationError ? error.code : error.code ?? "EIO",
		message: error instanceof Error ? error.message : "Command management failed."
	}) + "\n");
}
//#endregion
export {};
