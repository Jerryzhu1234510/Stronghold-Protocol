import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// File symlinks require a Windows capability; directory junction tests need no elevation.
export const fileSymlinksAvailable = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-link-cap-'));
  try {
    fs.writeFileSync(path.join(dir, 'target'), 'probe');
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return false;
    throw error;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
