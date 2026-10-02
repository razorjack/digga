# Persistence and lifecycle

Read this when working on persistence and lifecycle coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

| ID     | Scenario                                                                                                                                                                                                                                                    | P   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| PER-01 | A live snooze (`L`) with a note (`E`), and a keep mark on a track (`Shift+K`, its `POST /api/track-verdicts` awaited), survive a reload and a `relaunch()`                                                                                                  | P0  |
| PER-02 | After further changes, `digga backup` writes today's decisions; `digga restore` of that file into a fresh `small` library brings the verdicts back into Twelves                                                                                             | P2  |
| PER-03 | `relaunch({ crash: true })` during an import marks the job failed as interrupted; a graceful `relaunch()` during one records it cancelled once its page in flight has returned; Settings shows each                                                         | P2  |
| PER-04 | [`small-account` with a saved token] The server does not take a want (`route` aborts `POST /api/verdicts` once): "The verdict was not saved: …", the record comes back, and nothing has reached the fake Discogs; the same key again saves it and pushes it | P0  |
| PER-05 | `restartServer()` in the middle of a session, once the verdict's stats refresh has answered: the open page keeps its record, slip and session count without a reload, and the next verdict is saved (**web**)                                               | P1  |
