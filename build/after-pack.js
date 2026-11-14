'use strict';
// 仅在非 Windows 系统上交叉打包 Windows 版时使用：
// 没有 wine 时 electron-builder 无法用 rcedit 写入图标和版本信息，这里用纯 JS 的 resedit 补上。
// 在 Windows 上直接 npm run dist 时，electron-builder 会自己处理，本脚本什么也不做。
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (process.platform === 'win32' || ctx.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const name = ctx.packager.appInfo.productFilename;
  const exePath = path.join(ctx.appOutDir, `${name}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, ico.icons.map((i) => i.data));

  const v = ctx.packager.appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    for (const lang of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(lang, {
        ProductName: '之间', FileDescription: '之间', CompanyName: '刘博宇SolarSystem',
        LegalCopyright: '© 2026 刘博宇SolarSystem', OriginalFilename: `${name}.exe`, InternalName: name,
        FileVersion: ctx.packager.appInfo.version, ProductVersion: ctx.packager.appInfo.version
      });
    }
    vi.setFileVersion(v[0], v[1], v[2], 0);
    vi.setProductVersion(v[0], v[1], v[2], 0);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • resedit: 已写入图标和版本信息 → ${path.basename(exePath)}`);
};
