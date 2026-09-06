/// <reference lib="webworker" />
import { handleRequest, type EngineRequest, type EngineResponse } from './rpc'

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<EngineRequest>) => {
  const { id, method, params } = event.data
  let response: EngineResponse
  try {
    const result = await handleRequest(method, params)
    response = { id, ok: true, result }
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  scope.postMessage(response)
}
