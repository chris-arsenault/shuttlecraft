import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  gotoApp,
  openContextMenu,
  openSession,
  openTreeFile,
  selectMenuItem,
  treeRow,
  visibleTimelinePane,
} from "./helpers";

/**
 * Screenshot tour — walks the major surfaces and captures PNGs that feed
 * `docs/user-guide.md`. Gated behind SULION_SCREENSHOT_TOUR so it does not
 * fire during a normal `make e2e`.
 *
 *   SULION_SCREENSHOT_TOUR=1 make e2e
 *   python3 scripts/crop_screenshots.py
 *
 * The tour writes full-viewport PNGs plus a `crops.json` manifest of
 * bounding boxes under `docs/screenshots/raw/`. The cropper turns those
 * into the feature-focused PNGs the guide references.
 */

const SCREENSHOT_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "screenshots",
  "raw",
);

interface CropEntry {
  name: string;
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
}

const crops: CropEntry[] = [];

test.skip(
  !process.env.SULION_SCREENSHOT_TOUR,
  "screenshot tour runs on demand — set SULION_SCREENSHOT_TOUR=1",
);

test.use({ viewport: { width: 1440, height: 1024 } });

test.describe.configure({ mode: "serial" });

test("screenshot tour", async ({ page }) => {
  test.setTimeout(360_000);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  await gotoApp(page);

  await step("01-overview", async () => {
    await openSession(page, "Atlas Claude");
    await visibleTimelinePane(page).getByTestId("turn-row").first().waitFor();
    await shot(page, "01-overview.png");
    await recordCrop("01-sidebar", "01-overview.png", page.locator(".sidebar"), 4);
    await recordCrop("01-workspace", "01-overview.png", page.locator(".wa").first(), 4);
  });

  await step("02-command-palette", async () => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    const input = page.getByPlaceholder("Type a command or jump to…");
    await input.fill("Atlas");
    await expect(
      page.getByRole("option", { name: /Open session · atlas \/ Atlas Codex/i }),
    ).toBeVisible();
    await shot(page, "02-command-palette.png");
    await recordCrop(
      "02-command-palette",
      "02-command-palette.png",
      page.getByRole("dialog").first(),
      12,
    );
    await page.keyboard.press("Escape");
  });

  await step("03-timeline-turn", async () => {
    const timeline = visibleTimelinePane(page);
    const firstTurn = timeline.getByTestId("turn-row").first();
    await firstTurn.click();
    await expect(page.getByLabel("Prompt actions")).toBeVisible();
    await shot(page, "03-timeline-turn.png");
    await recordCrop("03-timeline-turn", "03-timeline-turn.png", timeline, 4);
  });

  await step("04-thinking-flyout", async () => {
    await page.getByLabel("View thinking").first().click();
    const flyout = page.getByTestId("thinking-flyout");
    await expect(flyout).toBeVisible();
    await shot(page, "04-thinking-flyout.png");
    await recordCrop("04-thinking-flyout", "04-thinking-flyout.png", flyout, 12);
    await page.getByLabel("Close thinking").click();
  });

  await step("05-tool-hover", async () => {
    const readTool = page
      .locator('[data-testid="tool-pair-row"][data-tool-type="read"]')
      .first();
    await readTool.hover();
    const card = page.getByTestId("tool-hover-card");
    await expect(card).toBeVisible();
    await shot(page, "05-tool-hover.png");
    await recordCrop("05-tool-hover", "05-tool-hover.png", card, 16);
  });

  await step("06-file-tab", async () => {
    await openTreeFile(page, "atlas", "src/lib.rs");
    const fileTab = page.getByTestId("file-tab").first();
    await expect(fileTab).toBeVisible();
    await shot(page, "06-file-tab.png");
    await recordCrop("06-file-tab", "06-file-tab.png", fileTab, 6);
    const trace = page.getByLabel("Related timeline turns");
    if ((await trace.count()) > 0) {
      await recordCrop("06-file-trace", "06-file-tab.png", trace.first(), 10);
    }
  });

  await step("07-diff-tab", async () => {
    await openContextMenu(treeRow(page, "atlas", "src/lib.rs"));
    await selectMenuItem(page, "Open diff");
    const diffTab = page.getByTestId("diff-tab").first();
    await expect(diffTab).toBeVisible();
    await shot(page, "07-diff-tab.png");
    await recordCrop("07-diff-tab", "07-diff-tab.png", diffTab, 6);
  });

  await step("08-context-menu", async () => {
    await openContextMenu(page.locator('[data-session-name="Atlas Claude"]'));
    const menu = page.getByRole("menu").first();
    await expect(menu).toBeVisible();
    await shot(page, "08-context-menu.png");
    await recordCrop("08-context-menu", "08-context-menu.png", menu, 12);
    await page.keyboard.press("Escape");
  });

  await step("09-session-pinned", async () => {
    const row = page.locator('[data-session-name="Atlas Claude"]');
    await openContextMenu(row);
    await selectMenuItem(page, "Pin to top");
    await openContextMenu(row);
    await page.getByRole("menuitem", { name: "Colour" }).hover();
    await page.getByRole("menuitem", { name: "teal" }).click();
    await expect(row.getByLabel("pinned")).toBeVisible();
    await shot(page, "09-session-pinned.png");
    await recordCrop("09-session-pinned", "09-session-pinned.png", page.locator(".sidebar"), 4);
    await openContextMenu(row);
    await selectMenuItem(page, "Unpin");
    await openContextMenu(row);
    await page.getByRole("menuitem", { name: "Colour" }).hover();
    await page.getByRole("menuitem", { name: "None" }).click();
  });

  await step("10-stats-strip", async () => {
    const stats = page.getByTestId("stats-strip");
    await expect(stats).toBeVisible();
    const toggle = page.getByRole("button", { name: "Toggle stats details" });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
    }
    await shot(page, "10-stats-strip.png");
    await recordCrop("10-stats-strip", "10-stats-strip.png", stats, 8);
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
    }
  });

  await step("11-codex-subagent", async () => {
    await page.locator('[data-session-name="Atlas Codex"]').click({ timeout: 5_000 });
    await page.waitForTimeout(800);
    const timeline = visibleTimelinePane(page);
    const turns = timeline.getByTestId("turn-row");
    if ((await turns.count()) === 0) return;
    await turns.first().click({ timeout: 5_000 });
    const viewAgent = page.getByRole("button", { name: /View agent log/i }).first();
    if ((await viewAgent.count()) === 0) return;
    await viewAgent.click({ timeout: 5_000 });
    const modal = page.getByTestId("subagent-modal");
    if (!(await modal.isVisible().catch(() => false))) return;
    await shot(page, "11-codex-subagent.png");
    await recordCrop("11-codex-subagent", "11-codex-subagent.png", modal, 16);
    await page.keyboard.press("Escape");
  });

  await step("12-repo-timeline", async () => {
    const repo = page.locator('[data-repo-name="atlas"]');
    if ((await repo.count()) === 0) return;
    await repo.click({ button: "right", timeout: 5_000 });
    const open = page.getByRole("menuitem", { name: "Open repo timeline" });
    if ((await open.count()) === 0) {
      await page.keyboard.press("Escape");
      return;
    }
    await open.click({ timeout: 5_000 });
    await page.waitForTimeout(600);
    await shot(page, "12-repo-timeline.png");
    await recordCrop("12-repo-timeline", "12-repo-timeline.png", visibleTimelinePane(page), 4);
  });

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "crops.json"),
    JSON.stringify(crops, null, 2) + "\n",
  );
});

async function step(name: string, body: () => Promise<void>): Promise<void> {
  await test.step(name, async () => {
    try {
      await body();
    } catch (error) {
      console.warn(`step ${name} failed:`, error);
    }
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, name),
    fullPage: false,
  });
}

async function recordCrop(
  name: string,
  source: string,
  locator: Locator,
  pad: number,
): Promise<void> {
  try {
    if ((await locator.count()) === 0) {
      console.warn(`recordCrop: no element for ${name}`);
      return;
    }
    const box = await locator.boundingBox({ timeout: 5_000 });
    if (!box) {
      console.warn(`recordCrop: no bounding box for ${name}`);
      return;
    }
    crops.push({
      name,
      source,
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.round(box.width),
      height: Math.round(box.height),
      pad,
    });
  } catch (error) {
    console.warn(`recordCrop ${name} failed:`, error);
  }
}
