'use strict';
// 跑全部单元测试：npm run test:unit（不联网、不需要 Key）
const fs = require('fs');
const path = require('path');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) require(path.join(__dirname, f));
