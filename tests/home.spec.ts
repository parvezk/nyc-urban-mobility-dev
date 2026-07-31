import { test, expect } from '@playwright/test';

test('homepage loads and displays map', async ({ page }) => {
  await page.goto('/');

  // You can add more specific assertions based on your application
  // For example, checking if the map container exists
  // await expect(page.locator('.map-container')).toBeVisible();
});
