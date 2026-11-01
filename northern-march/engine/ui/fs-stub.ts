export function readFileSync(): never { throw new Error("no file system in the browser"); }
export function existsSync() { return false; }
export function appendFileSync(): never { throw new Error("no file system in the browser"); }
export function mkdirSync() {}
export function writeFileSync(): never { throw new Error("no file system in the browser"); }
export function readdirSync() { return []; }
