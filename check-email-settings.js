import { connectDB } from './src/config/database.js';
import AppSettingsModel from './src/db/models/AppSettings.js';

async function checkEmailSettings() {
  try {
    await connectDB();
    const settings = await AppSettingsModel.findOne();

    console.log('=== EMAIL SETTINGS CHECK ===');
    console.log('systemEmailHost:', settings?.systemEmailHost);
    console.log('systemEmailPort:', settings?.systemEmailPort, '(type:', typeof settings?.systemEmailPort, ')');
    console.log('systemEmailAddress:', settings?.systemEmailAddress);
    console.log('systemEmailUser:', settings?.systemEmailUser);
    console.log('systemEmailPassword:', settings?.systemEmailPassword ? '[SET]' : '[NOT SET]');
    console.log('systemEmailSecure:', settings?.systemEmailSecure);

    // Check for common issues
    const issues = [];

    if (!settings?.systemEmailHost) issues.push('Missing SMTP host');
    if (!settings?.systemEmailPort) issues.push('Missing SMTP port');
    if (!settings?.systemEmailAddress) issues.push('Missing from email address');
    if (!settings?.systemEmailPassword) issues.push('Missing password');

    if (settings?.systemEmailPort && isNaN(Number(settings.systemEmailPort))) {
      issues.push('Port is not a valid number');
    }

    if (issues.length > 0) {
      console.log('\n❌ ISSUES FOUND:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('\n✅ All required settings appear to be configured');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking settings:', error);
    process.exit(1);
  }
}

checkEmailSettings();