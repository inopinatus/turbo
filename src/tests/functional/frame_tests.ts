import { FunctionalTestCase } from "../helpers/functional_test_case"

export class FrameTests extends FunctionalTestCase {
  async setup() {
    await this.goToLocation("/src/tests/fixtures/frames.html")
  }

  async "test following a link to a page without a matching frame results in an empty frame"() {
    await this.clickSelector("#missing a")
    await this.nextBeat
    this.assert.notOk(await this.innerHTMLForSelector("#missing"))
  }

  async "test loading a tbody element"() {
    await this.clickSelector("#tbody0 a")
    await this.nextBeat

    const contentsTd = await this.querySelector("#tbody0 td")
    this.assert.equal(await contentsTd.getVisibleText(), "Table service")

    const contentsTh = await this.querySelector("#thead0 th")
    this.assert.equal(await contentsTh.getVisibleText(), "table thead0")
  }
}

FrameTests.registerSuite()
