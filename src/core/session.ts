import { Adapter } from "./native/adapter"
import { BrowserAdapter } from "./native/browser_adapter"
import { FormSubmitObserver } from "../observers/form_submit_observer"
import { FrameRedirector } from "./frames/frame_redirector"
import { defineCustomFrameElement } from "../elements"
import { History, HistoryDelegate } from "./drive/history"
import { LinkClickObserver, LinkClickObserverDelegate } from "../observers/link_click_observer"
import { expandURL, isPrefixedBy, isHTML, Locatable } from "./url"
import { Navigator, NavigatorDelegate } from "./drive/navigator"
import { PageObserver, PageObserverDelegate } from "../observers/page_observer"
import { ScrollObserver } from "../observers/scroll_observer"
import { StreamMessage } from "./streams/stream_message"
import { StreamObserver } from "../observers/stream_observer"
import { Action, Position, StreamSource, isAction } from "./types"
import { dispatch } from "../util"
import { View } from "./drive/view"
import { Visit, VisitOptions } from "./drive/visit"

export type TimingData = {}

export class Session implements HistoryDelegate, LinkClickObserverDelegate, NavigatorDelegate, PageObserverDelegate {
  readonly navigator = new Navigator(this)
  readonly history = new History(this)
  readonly view = new View(this)
  adapter: Adapter = new BrowserAdapter(this)

  readonly pageObserver = new PageObserver(this)
  readonly linkClickObserver = new LinkClickObserver(this)
  readonly formSubmitObserver = new FormSubmitObserver(this)
  readonly scrollObserver = new ScrollObserver(this)
  readonly streamObserver = new StreamObserver(this)

  readonly frameRedirector = new FrameRedirector(document.documentElement)

  enabled = true
  progressBarDelay = 500
  started = false

  start() {
    if (!this.started) {
      this.pageObserver.start()
      this.linkClickObserver.start()
      this.formSubmitObserver.start()
      this.scrollObserver.start()
      this.streamObserver.start()
      this.frameRedirector.start()
      this.history.start()
      this.started = true
      this.enabled = true
    }
  }

  disable() {
    this.enabled = false
  }

  stop() {
    if (this.started) {
      this.pageObserver.stop()
      this.linkClickObserver.stop()
      this.formSubmitObserver.stop()
      this.scrollObserver.stop()
      this.streamObserver.stop()
      this.frameRedirector.stop()
      this.history.stop()
      this.started = false
    }
  }

  registerAdapter(adapter: Adapter) {
    this.adapter = adapter
  }

  visit(location: Locatable, options: Partial<VisitOptions> = {}) {
    this.navigator.proposeVisit(expandURL(location), options)
  }

  connectStreamSource(source: StreamSource) {
    this.streamObserver.connectStreamSource(source)
  }

  disconnectStreamSource(source: StreamSource) {
    this.streamObserver.disconnectStreamSource(source)
  }

  renderStreamMessage(message: StreamMessage | string) {
    document.documentElement.appendChild(StreamMessage.wrap(message).fragment)
  }

  clearCache() {
    this.view.clearSnapshotCache()
  }

  setProgressBarDelay(delay: number) {
    this.progressBarDelay = delay
  }

  defineCustomFrameElement(name: string) {
    defineCustomFrameElement(name)
  }

  get location() {
    return this.history.location
  }

  get restorationIdentifier() {
    return this.history.restorationIdentifier
  }

  // History delegate

  historyPoppedToLocationWithRestorationIdentifier(location: URL) {
    if (this.enabled) {
      this.navigator.proposeVisit(location, { action: "restore", historyChanged: true })
    } else {
      this.adapter.pageInvalidated()
    }
  }

  // Scroll observer delegate

  scrollPositionChanged(position: Position) {
    this.history.updateRestorationData({ scrollPosition: position })
  }

  // Link click observer delegate

  willFollowLinkToLocation(link: Element, location: URL) {
    return this.elementIsNavigable(link)
      && this.locationIsVisitable(location)
      && this.applicationAllowsFollowingLinkToLocation(link, location)
  }

  followedLinkToLocation(link: Element, location: URL) {
    const action = this.getActionForLink(link)
    this.visit(location.href, { action })
  }

  // Navigator delegate

  allowsVisitingLocation(location: URL) {
    return this.applicationAllowsVisitingLocation(location)
  }

  visitProposedToLocation(location: URL, options: Partial<VisitOptions>) {
    this.adapter.visitProposedToLocation(location, options)
  }

  visitStarted(visit: Visit) {
    this.notifyApplicationAfterVisitingLocation(visit.location)
  }

  visitCompleted(visit: Visit) {
    this.notifyApplicationAfterPageLoad(visit.getTimingMetrics())
  }

  // Form submit observer delegate

  willSubmitForm(form: HTMLFormElement, submitter?: HTMLElement): boolean {
    return this.elementIsNavigable(form) && this.elementIsNavigable(submitter)
  }

  formSubmitted(form: HTMLFormElement, submitter?: HTMLElement) {
    this.navigator.submitForm(form, submitter)
  }

  // Page observer delegate

  pageBecameInteractive() {
    this.view.lastRenderedLocation = this.location
    this.notifyApplicationAfterPageLoad()
  }

  pageLoaded() {
    this.history.assumeControlOfScrollRestoration()
  }

  pageWillUnload() {
    this.history.relinquishControlOfScrollRestoration()
  }

  // Stream observer delegate

  receivedMessageFromStream(message: StreamMessage) {
    this.renderStreamMessage(message)
  }

  // View delegate

  viewWillRender(newBody: HTMLBodyElement) {
    this.notifyApplicationBeforeRender(newBody)
  }

  viewRendered() {
    this.view.lastRenderedLocation = this.history.location
    this.notifyApplicationAfterRender()
  }

  viewInvalidated() {
    this.adapter.pageInvalidated()
  }

  viewWillCacheSnapshot() {
    this.notifyApplicationBeforeCachingSnapshot()
  }

  // Application events

  applicationAllowsFollowingLinkToLocation(link: Element, location: URL) {
    const event = this.notifyApplicationAfterClickingLinkToLocation(link, location)
    return !event.defaultPrevented
  }

  applicationAllowsVisitingLocation(location: URL) {
    const event = this.notifyApplicationBeforeVisitingLocation(location)
    return !event.defaultPrevented
  }

  notifyApplicationAfterClickingLinkToLocation(link: Element, location: URL) {
    return dispatch("turbo:click", { target: link, detail: { url: location.href }, cancelable: true })
  }

  notifyApplicationBeforeVisitingLocation(location: URL) {
    return dispatch("turbo:before-visit", { detail: { url: location.href }, cancelable: true })
  }

  notifyApplicationAfterVisitingLocation(location: URL) {
    return dispatch("turbo:visit", { detail: { url: location.href } })
  }

  notifyApplicationBeforeCachingSnapshot() {
    return dispatch("turbo:before-cache")
  }

  notifyApplicationBeforeRender(newBody: HTMLBodyElement) {
    return dispatch("turbo:before-render", { detail: { newBody }})
  }

  notifyApplicationAfterRender() {
    return dispatch("turbo:render")
  }

  notifyApplicationAfterPageLoad(timing: TimingData = {}) {
    return dispatch("turbo:load", { detail: { url: this.location.href, timing }})
  }

  // Private

  getActionForLink(link: Element): Action {
    const action = link.getAttribute("data-turbo-action")
    return isAction(action) ? action : "advance"
  }

  elementIsNavigable(element?: Element) {
    const container = element?.closest("[data-turbo]")
    if (container) {
      return container.getAttribute("data-turbo") != "false"
    } else {
      return true
    }
  }

  locationIsVisitable(location: URL) {
    return isPrefixedBy(location, this.view.getRootLocation()) && isHTML(location)
  }
}
