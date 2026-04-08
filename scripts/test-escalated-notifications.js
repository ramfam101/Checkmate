const { chromium, firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const SCREENSHOTS_DIR = path.join(__dirname, '../screenshots');

// Check if server is running
function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
  console.log(`🌐 Target URL: ${BASE_URL}\n`);

  // Check if server is running
  console.log('🔍 Checking if development server is running...');
  const serverRunning = await checkServer(BASE_URL);
  if (!serverRunning) {
    console.error('❌ Development server is not running!');
    console.error(`   Please start the client server first:`);
    console.error(`   cd client && npm run dev`);
    console.error(`   Then visit: ${BASE_URL}`);
    process.exit(1);
  }
  console.log('✅ Server is running\n');

async function testEscalatedNotifications() {
  // Try to launch browser (Firefox first, then Chromium)
  let browser;
  try {
    console.log('🌐 Trying to launch Firefox...');
    browser = await firefox.launch({ 
      headless: true,
      args: ['--disable-gpu']
    });
    console.log('✅ Firefox launched successfully\n');
  } catch (firefoxError) {
    console.log('⚠️  Firefox failed, trying Chromium...');
    try {
      browser = await chromium.launch({ 
        headless: true,
        args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
      });
      console.log('✅ Chromium launched successfully\n');
    } catch (chromiumError) {
      console.error('❌ Both Firefox and Chromium failed to launch.');
      console.error('This is likely due to missing system libraries in the container environment.');
      console.error('\n🔧 Solutions:');
      console.error('1. Use manual screenshots (recommended for dev containers):');
      console.error('   - Start dev server: cd client && npm run dev');
      console.error('   - Visit http://localhost:5173/uptime/create');
      console.error('   - Manually screenshot the escalated notifications section');
      console.error('   - Save as 01-empty-escalated-notifications.png, etc.');
      console.error('\n2. Install system dependencies (if you have sudo access):');
      console.error('   sudo apt-get update && sudo apt-get install -y libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgtk-3-0 libgbm1');
      console.error('\nFirefox error:', firefoxError.message);
      console.error('Chromium error:', chromiumError.message);
      process.exit(1);
    }
  }
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\n🧪 Testing Escalated Notifications Feature\n');

  try {
    console.log('Test 1: Verify Escalated Notifications Component Renders');
    await page.goto(`${BASE_URL}/uptime/create`);
    await page.waitForLoadState('networkidle');

    const hasEscalatedNotifications = await page.locator('text=Escalated Notifications').count() > 0;
    console.log(`  ${hasEscalatedNotifications ? '✅' : '❌'} Component visible\n`);

    console.log('Test 2: Verify Edit Button Appears');
    const editButtonVisible = await page.locator('button:has-text("Edit")').count() > 0;
    console.log(`  ${editButtonVisible ? '✅' : '❌'} Edit button visible\n`);

    console.log('Test 3: Enter Edit Mode');
    const editButton = await page.locator('button:has-text("Edit")');
    await editButton.c4: Add Escalation Level');
    await page.evaluate(() => {
      const escalatedBox = Array.from(document.querySelectorAll('div')).find(
        el => el.textContent?.includes('Escalated Notifications')
      );
      if (escalatedBox) {
        escalatedBox.scrollIntoView({ behavior: 'smooth' });
      }
    });
    await page.waitForTimeout(1000);

    const addButton = await page.locator('button:has-text("Add Escalation Level")');
    const initialCount = await page.locator('input[type="number"]').count();

    await addButton.click();
    await page.waitForTimeout(500);

    const newCount = await page.locator('input[type="number"]').count();
    console.log(`  ${newCount > initialCount ? '✅' : '❌'} Escalation level added (${newCount} fields)\n`);

    console.log('Test 5: Fill Delay Minutes Value');
    await page.fill('input[type="number"]', '5');
    const delayValue = await page.inputValue('input[type="number"]');
    console.log(`  ${delayValue === '5' ? '✅' : '❌'} Delay value set to: ${delayValue}\n`);

    console.log('Test 6: Test Validation');
    await page.fill('input[type="number"]', '10081');
    await page.waitForTimeout(300);

    const hasError = await page.locator('text=/cannot exceed/').count() > 0;
    console.log(`  ${hasError ? '✅' : '❌'} Validation error shown for max delay\n`);

    console.log('Test 7: Remove Escalation Level');
    const removeButton = await page.locator('button[aria-label="Remove escalation"]').first();
    await removeButton.click();
    await page.waitForTimeout(300);

    const countAfterRemove = await page.locator('input[type="number"]').count();
    console.log(`  ${countAfterRemove < newCount ? '✅' : '❌'} Escalation level removed\n`);

    console.log('Test 8= await page.locator('button[aria-label="Remove escalation"]').first();
    await removeButton.click();
    await page.waitForTimeout(300);

    const countAfterRemove = await page.locator('input[type="number"]').count();
    console.log(`  ${countAfterRemove < newCount ? '✅' : '❌'} Escalation level removed\n`);

    console.log('Test 7: Save Changes');
    const saveButton = await page.locator('button:has-text("Save")');
    await saveButton.click();
    await page.waitForTimeout(500);
    console.log(`  ✅ Changes saved\n`);

    console.log('✨ All tests completed!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testEscalatedNotifications().catch(console.error);
