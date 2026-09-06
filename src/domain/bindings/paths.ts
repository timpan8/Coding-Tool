/** Where a path stops being yours and starts being the code's.
 *
 * `C:\Scripts\AdSync\run.log` is two things at once: a folder that belongs to this machine, and a
 * file name that belongs to the script. Binding the whole string protects both, and then an AI
 * that renames the log file has to be corrected by hand — or worse, its new name is lost when the
 * placeholder goes back in. Binding the directory alone protects what is private and leaves the
 * file name where the code can talk about it. */

const WINDOWS = /^(?:[a-zA-Z]:\\|\\\\[^\\]+\\)/;
const UNIX = /^\//;

/** True for a path whose last segment looks like a file rather than a folder. A segment with a
 * short extension and no trailing separator: `run.log`, `config.json`, `Create-Users.ps1`. */
export function looksLikeFile(value: string): boolean {
  const last = value.split(/[\\/]/).pop() ?? '';
  return /^[^\\/]+\.[A-Za-z0-9]{1,8}$/.test(last);
}

/** The directory part of a path, or the whole value when there is nothing to trim: a path that
 * already names a folder, a value that is not a path at all, or one whose directory would be the
 * bare root (`C:\run.log` keeps its drive rather than binding `C:`). */
export function directoryPart(value: string): string {
  if (!WINDOWS.test(value) && !UNIX.test(value)) return value;
  if (!looksLikeFile(value)) return value;
  const cut = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (cut <= 0) return value;
  const directory = value.slice(0, cut);
  // `C:\`, `\\server\`, `/` — a root on its own is not a private value worth a binding.
  return WINDOWS.test(directory + '\\') && directory.length <= 2 ? value : directory || value;
}

/** The span to bind for a path found in code: the directory, with the file name left in place.
 * Returns the original span unchanged for anything that is not a file path. */
export function trimToDirectory(text: string, start: number, end: number): { start: number; end: number } {
  const value = text.slice(start, end);
  const directory = directoryPart(value);
  return directory === value ? { start, end } : { start, end: start + directory.length };
}
