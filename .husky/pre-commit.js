#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const packages = ['client', 'server'];

try {
  console.log('Running lint-staged...');
  
  for (const pkg of packages) {
    console.log(`\nLinting ${pkg}...`);
    const pkgPath = path.join(__dirname, '..', pkg);
    execSync('npx lint-staged', {
      cwd: pkgPath,
      stdio: 'inherit'
    });
  }
  
  process.exit(0);
} catch (error) {
  process.exit(1);
}
