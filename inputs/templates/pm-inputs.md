# PM inputs

<!--
HOW TO FILL THIS IN
- Copy this file to inputs/my-project/pm-inputs.md first. That folder is ignored by git, so your
  real project data never gets committed.
- Replace the example rows (they describe the fictional "Project Atlas"). Keep the headings, the
  "Label:" text and the table header rows exactly as they are; the checker reads them.
- Dates are YYYY-MM-DD. Use today's real dates: past due dates are reported as overdue.
- Leave a whole section empty to skip that agent.
- Then check it:  node inputs/check-inputs.mjs inputs/my-project/pm-inputs.md
-->

## Privacy check

Names that must never reach the AI. List real client, vendor and colleague names here, one per
line. The checker stops if any of them appears anywhere else in this file. This section itself is
never sent anywhere.

- Example Client Inc

## Project

- Name: Project Atlas: CRM Migration
- Sponsor: VP Sales Operations
- Phase: Build
- Budget planned: 250000
- Budget spent: 171000
- End date: 2027-01-12
- Approver email: you@example.com

### Team notes

- Billing vendor says sandbox credentials will arrive early next week, no firm date.
- Two UAT testers are shared with the Q4 audit and may be unavailable for 5 days.

## Tasks

Status is one of: Not Started, In Progress, Blocked, Done. Critical is Yes or No.
Milestone (optional) must match a name in the Milestones table.

| ID | Task | Owner | Workstream | Due | Progress % | Status | Critical | Blocker | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| T-101 | Data mapping sign-off | A. Chen | Data | 2026-11-20 | 100 | Done | Yes | | Data migration dry run |
| T-104 | API integration with billing system | R. Patel | Integrations | 2026-12-02 | 60 | Blocked | Yes | Waiting on vendor sandbox credentials | Data migration dry run |
| T-107 | UAT test scripts | S. Nguyen | Testing | 2026-12-10 | 30 | In Progress | No | | UAT start |

## Milestones

Depends on (optional) must match another milestone name. Status: leave empty while open, or write
Done once it is finished (a finished milestone's old slip no longer turns the status red).

| Milestone | Baseline | Forecast | Depends on | Status |
|---|---|---|---|---|
| Data migration dry run | 2026-12-01 | 2026-12-08 | | |
| UAT start | 2026-12-15 | 2026-12-17 | Data migration dry run | |
| Go-live | 2027-01-12 | 2027-01-12 | UAT start | |

## Risks and issues

Type is one of: Risk, Assumption, Issue, Dependency. Impact and Likelihood are High, Medium or Low.

| Type | Title | Impact | Likelihood | Owner | Mitigation |
|---|---|---|---|---|---|
| Risk | Billing vendor sandbox access delayed | High | Medium | R. Patel | Weekly check-in with the vendor account manager |

## Meeting

Feeds 02 Meeting → Actions.

- Meeting name: Project Atlas weekly sync
- Meeting date: 2026-11-26
- Attendee emails:

### Transcript

```
PM: Where are we on the billing integration?
R. Patel: Still blocked on sandbox credentials. The vendor says early next week.
PM: OK. Decision: we move the dry run to December 8. Can you chase the vendor daily?
R. Patel: Yes, I'll own that.
```

## Stakeholder update

Feeds 03 Stakeholder Translator. Audiences: any of Executive, Team, Client.

- Audiences: Executive, Team, Client
- Client name: the client

### Update

```
Data mapping is signed off and dashboards shipped a day early. The billing integration is blocked
on vendor sandbox credentials, so the dry run moves from Dec 1 to Dec 8. Go-live stays Jan 12.
```

### Internal only

```
The vendor is two weeks late on their contract commitment and we are considering penalties.
```

## Requests

Feeds 04 Intake Triage, one run per row. Impact is one of: Blocks our work, Affects customers or
revenue, Improvement / nice to have.

| Requester | Email | Team | Title | Description | Impact | Needed by |
|---|---|---|---|---|---|---|
| Sales Ops lead | requester@example.com | Sales Operations | Add a region filter to the pipeline dashboard | Regional managers need to see only their own pipeline for weekly reviews. | Improvement / nice to have | 2026-12-15 |

## Retro

Feeds 05 Retro Synthesizer. Collect answers anonymously (for example Microsoft Forms set to
anonymous) and paste them here with no names. The agent needs at least 3 responses.

- Retro name: Atlas Sprint 14

| Mood 1-5 | Went well | To improve | Ideas |
|---|---|---|---|
| 3 | Dashboards shipped early. | We heard about the vendor delay from the sponsor first. | A shared vendor-dependency tracker. |
| 2 | Pairing on data mapping helped. | Ad-hoc requests hit developers directly. | All requests go through the intake form. |
| 4 | Standups were short and useful. | Nobody owned the test environment. | Name an owner each sprint. |
