import { suggestBalancedSetPoints, type BalanceEntry } from './pointSuggestions'

self.onmessage = (event: MessageEvent<BalanceEntry[]>) => {
  try {
    self.postMessage({ suggestion: suggestBalancedSetPoints(event.data), failed: false })
  } catch {
    self.postMessage({ suggestion: null, failed: true })
  }
}
