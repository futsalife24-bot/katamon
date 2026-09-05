import type { Page } from '@playwright/test';
export async function attachSyntheticCharacter(
  page: Page,
  selector = '[data-testid="image-input"]',
  fileName = 'sample-character.png',
  hitVariant = false,
): Promise<void> {
  // Draft creation writes IndexedDB before mounting the file input. Hidden hit inputs are valid.
  await page.locator(selector).waitFor({ state: 'attached' });
  await page.evaluate(async ({ selector: inputSelector, fileName: name, hitVariant: isHit }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvasを初期化できませんでした。');
    for (let y = 0;y < 128;y += 8) {
      for (let x = 0;x < 128;x += 8) {
        context.fillStyle = ((x + y) / 8) % 2 === 0 ? '#f6f6f6' : '#e8e8e8';
        context.fillRect(x, y, 8, 8);
      }
    }
    context.fillStyle = '#e6a51c';
    context.beginPath();
    context.arc(62, 53, 30, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#243347';
    context.fillRect(26, 78, 76, 25);
    context.fillStyle = '#35d7de';
    context.fillRect(75, 54, 39, 10);
    context.fillStyle = '#111827';
    context.fillRect(38, 103, 23, 12);
    context.fillRect(72, 103, 23, 12);
    if (isHit) {
      context.fillStyle = '#f4f7fb';
      context.fillRect(48, 43, 10, 4);
      context.fillRect(68, 43, 10, 4);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNGを作成できませんでした。')), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: 'image/png', lastModified: Date.now() }));
    const input = document.querySelector<HTMLInputElement>(inputSelector);
    if (!input) throw new Error('画像入力が見つかりませんでした。');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, fileName, hitVariant });
}
