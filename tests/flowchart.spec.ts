import { test, expect, Page, Locator } from '@playwright/test'
import { readFileSync } from 'fs'

const APP_URL = 'http://localhost:3000'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Click a toolbar button to add a node, wait for it to appear, set its label,
 * and return an nth-indexed Locator that stably points to the new node.
 */
async function addNode(
  page: Page,
  type: 'rectangle' | 'diamond' | 'oval',
  label: string,
): Promise<Locator> {
  const countBefore = await page.getByTestId('node').count()
  await page.getByTestId(`add-${type}`).click()
  await expect(page.getByTestId('node')).toHaveCount(countBefore + 1, { timeout: 5000 })

  // nth(countBefore) is the newly appended node; stable as long as node order is preserved
  const newNode = page.getByTestId('node').nth(countBefore)
  const labelEl = newNode.getByTestId('node-label')

  await labelEl.click()
  await page.waitForTimeout(150) // let edit mode activate

  // Select-all works for both <input> and contenteditable
  await page.keyboard.press('Control+a')
  await page.keyboard.type(label)
  await page.keyboard.press('Enter')

  return newNode
}

/**
 * Hover over sourceNode to reveal handles, then drag from the specified edge
 * of sourceNode to the centre of targetNode to create a directed connection.
 */
async function connectNodes(
  page: Page,
  sourceNode: Locator,
  targetNode: Locator,
  handleSide: 'right' | 'bottom' | 'left' | 'top' = 'right',
): Promise<void> {
  await sourceNode.hover()
  await page.waitForTimeout(300) // wait for handles to become interactive

  const srcBox = await sourceNode.boundingBox()
  const tgtBox = await targetNode.boundingBox()
  if (!srcBox || !tgtBox) throw new Error('Could not obtain bounding boxes for drag')

  const cx = srcBox.x + srcBox.width / 2
  const cy = srcBox.y + srcBox.height / 2
  const handlePositions: Record<string, { x: number; y: number }> = {
    right:  { x: srcBox.x + srcBox.width,  y: cy },
    left:   { x: srcBox.x,                 y: cy },
    top:    { x: cx,                        y: srcBox.y },
    bottom: { x: cx,                        y: srcBox.y + srcBox.height },
  }

  const { x: startX, y: startY } = handlePositions[handleSide]
  const endX = tgtBox.x + tgtBox.width / 2
  const endY = tgtBox.y + tgtBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(endX, endY, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('ASCII Flowchart Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL)
  })

  // ── TC-01 ──────────────────────────────────────────────────────────────────
  test(
    'TC-01: two-node flowchart generates ASCII with both labels and an arrow',
    async ({ page }) => {
      const startNode = await addNode(page, 'rectangle', 'Start')
      const endNode   = await addNode(page, 'rectangle', 'End')

      await connectNodes(page, startNode, endNode)

      await page.getByTestId('generate-ascii').click()

      const output = page.getByTestId('ascii-output')
      await expect(output).toBeVisible()

      const text = (await output.textContent()) ?? ''
      expect(text).toContain('Start')
      expect(text).toContain('End')
      // At least one connection arrow character must appear
      expect(text).toMatch(/[><v^]/)
    },
  )

  // ── TC-02 ──────────────────────────────────────────────────────────────────
  test(
    'TC-02: diamond decision node with two outgoing connections renders in ASCII',
    async ({ page }) => {
      const diamondNode = await addNode(page, 'diamond',   'Yes/No')
      const pathANode   = await addNode(page, 'rectangle', 'Path A')
      const pathBNode   = await addNode(page, 'rectangle', 'Path B')

      // First connection: Yes/No → Path A (right handle)
      await connectNodes(page, diamondNode, pathANode, 'right')
      // Second connection: Yes/No → Path B (bottom handle — different from the first)
      await connectNodes(page, diamondNode, pathBNode, 'bottom')

      await page.getByTestId('generate-ascii').click()

      const output = page.getByTestId('ascii-output')
      await expect(output).toBeVisible()

      const text = (await output.textContent()) ?? ''
      expect(text).toContain('Yes/No')
      // Diamond nodes must use diagonal border characters
      expect(text).toMatch(/[/\\]/)
      expect(text).toContain('Path A')
      expect(text).toContain('Path B')
      // One arrow per connection path — at least two total
      const arrowChars = text.match(/[><v^]/g) ?? []
      expect(arrowChars.length).toBeGreaterThanOrEqual(2)
    },
  )

  // ── TC-03 ──────────────────────────────────────────────────────────────────
  test(
    'TC-03: saving and reloading a flowchart restores all nodes and connections',
    async ({ page }) => {
      // Unique name avoids conflicts across repeated test runs against the same DB
      const flowName = `my-flow-${Date.now()}`

      await addNode(page, 'rectangle', 'Start')
      await addNode(page, 'rectangle', 'End')

      // Connect the two nodes before saving
      const nodes = page.getByTestId('node')
      await connectNodes(page, nodes.nth(0), nodes.nth(1))

      // Persist the flowchart
      await page.getByTestId('flowchart-name-input').fill(flowName)
      await page.getByTestId('save-btn').click()

      // Hard-reload — canvas must be empty (spec: "canvas starts empty on fresh page load")
      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.getByTestId('canvas')).toBeVisible()
      await expect(page.getByTestId('node')).toHaveCount(0)

      // Restore the saved flowchart via the dropdown
      await page.getByTestId('flowchart-select').selectOption(flowName)
      await page.getByTestId('load-btn').click()

      // All nodes must be restored
      await expect(page.getByTestId('node')).toHaveCount(2, { timeout: 5000 })
      const labelTexts = await page.getByTestId('node-label').allTextContents()
      expect(labelTexts).toContain('Start')
      expect(labelTexts).toContain('End')

      // Verify the connection was also restored: generate ASCII and check for an arrow
      await page.getByTestId('generate-ascii').click()
      const ascii = (await page.getByTestId('ascii-output').textContent()) ?? ''
      expect(ascii).toMatch(/[><v^]/)
    },
    30_000,
  )

  // ── TC-04 ──────────────────────────────────────────────────────────────────
  test(
    'TC-04: copy-to-clipboard produces text matching the ASCII output',
    async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])

      await addNode(page, 'rectangle', 'Alpha')
      await addNode(page, 'rectangle', 'Beta')

      const nodes = page.getByTestId('node')
      await connectNodes(page, nodes.nth(0), nodes.nth(1))

      await page.getByTestId('generate-ascii').click()

      const expectedText = (await page.getByTestId('ascii-output').textContent()) ?? ''
      expect(expectedText.length).toBeGreaterThan(0)

      await page.getByTestId('copy-ascii').click()

      const clipboardText: string = await page.evaluate(() =>
        navigator.clipboard.readText(),
      )
      expect(clipboardText).toBe(expectedText)
    },
  )

  // ── TC-05 ──────────────────────────────────────────────────────────────────
  test(
    'TC-05: export button downloads a .txt file whose contents match the ASCII output',
    async ({ page }) => {
      await addNode(page, 'oval', 'Begin')
      await addNode(page, 'oval', 'Finish')

      const nodes = page.getByTestId('node')
      await connectNodes(page, nodes.nth(0), nodes.nth(1))

      await page.getByTestId('generate-ascii').click()

      const expectedText = (await page.getByTestId('ascii-output').textContent()) ?? ''
      expect(expectedText.length).toBeGreaterThan(0)

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.getByTestId('export-txt').click(),
      ])

      expect(download.suggestedFilename()).toMatch(/\.txt$/i)

      const downloadPath = await download.path()
      expect(downloadPath).not.toBeNull()

      const fileContent = readFileSync(downloadPath!, 'utf-8')
      expect(fileContent).toBe(expectedText)
    },
    20_000,
  )
})
