import { test, expect } from "@playwright/test";

test.describe("Visual Regression Testing", () => {
  test(`Calibrate page`, async ({ page }) => {
    await page.goto("/en/calibrate");
    await expect(page.getByTestId("calibration-canvas")).toBeVisible();
    await expect(page).toHaveScreenshot(`calibrate.png`, {
      fullPage: true,
      mask: [page.getByTestId("calibration-canvas")], // rendering of canvas is non-deterministic
    });
  });

  test(`Home page`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-title")).toBeVisible();
    await expect(page).toHaveScreenshot(`home.png`, {
      fullPage: true,
    });
  });
});
