import type { PreloadApi } from '@shared/ipc/contract'
import { ApiError, call, OUTDATED_MESSAGE, setBridge } from './client'

describe('call', () => {
  it('says to restart when the main process does not know the channel yet', async () => {
    setBridge({
      invoke: () =>
        Promise.reject(
          new Error(
            "Error invoking remote method 'sb:portal.agentStart': Error: No handler registered for 'sb:portal.agentStart'"
          )
        ),
      on: () => () => undefined
    } as unknown as PreloadApi)
    const err = await call('portal.agentState', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ kind: 'internal', message: OUTDATED_MESSAGE })
  })
})
