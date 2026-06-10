import puppeteer from 'puppeteer';

async function main() {
  console.log('启动浏览器...');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // 打开前端界面
  console.log('打开 Mind Agency...');
  await page.goto('http://localhost:3000');
  await page.waitForSelector('body');

  // 等待页面加载
  await new Promise(r => setTimeout(r, 3000));

  // 截图
  await page.screenshot({ path: 'workflow-screenshot15.png', fullPage: true });
  console.log('截图已保存');

  // 点击"群组"按钮
  console.log('点击群组按钮...');
  await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.includes('群组')) {
        span.click();
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  // 截图
  await page.screenshot({ path: 'workflow-screenshot16.png', fullPage: true });
  console.log('截图已保存');

  // 关闭浏览器
  await browser.close();
  console.log('完成');
}

main().catch(console.error);
