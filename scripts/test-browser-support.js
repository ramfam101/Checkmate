const { chromium, firefox } = require('playwright');

async function testBrowserSupport() {
  console.log('🧪 Testing Browser Support in Dev Environment\n');

  // Test Firefox
  try {
    console.log('🌐 Testing Firefox...');
    const firefoxBrowser = await firefox.launch({
      headless: true,
      args: ['--disable-gpu'],
      timeout: 10000
    });
    await firefoxBrowser.close();
    console.log('✅ Firefox: WORKING\n');
  } catch (error) {
    console.log('❌ Firefox: FAILED');
    console.log(`   Error: ${error.message}\n`);
  }

  // Test Chromium
  try {
    console.log('🌐 Testing Chromium...');
    const chromiumBrowser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 10000
    });
    await chromiumBrowser.close();
    console.log('✅ Chromium: WORKING\n');
  } catch (error) {
    console.log('❌ Chromium: FAILED');
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('💡 Recommendation:');
  console.log('   If both browsers fail → Use manual screenshots');
  console.log('   If Firefox works → Use automated scripts');
  console.log('   If only Chromium works → Scripts will use Chromium fallback');
}

testBrowserSupport().catch(console.error);