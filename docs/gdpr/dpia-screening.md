# DSFA-Schwellwertanalyse / DPIA screening (Art. 35 GDPR)

*Date: [date] · Assessor: [name] · Scope: CadSandbox server + web app as implemented.*

## Criteria (EDPB WP248 rev.01 + DSK "Muss-Liste")

| # | Criterion | Applies? | Reasoning |
|---|---|---|---|
| 1 | Evaluation/scoring, profiling | No | No profiling, analytics or tracking. |
| 2 | Automated decisions with legal/similar effect | No | None; bans are manual admin decisions. |
| 3 | Systematic monitoring | No | Only security audit log of account actions; no behavioural monitoring; presence data is ephemeral and visible only to collaborators. |
| 4 | Sensitive data (Art. 9/10) | No (by design) | Not requested; users could theoretically upload such data in project files — mitigated by encryption at rest, access control, DPA clause § 2. |
| 5 | Large scale | Depends | Re-assess above ~[100 000] users or if used by public authorities. |
| 6 | Matching/combining datasets | No | No enrichment or third-party data. |
| 7 | Vulnerable data subjects | No | Professional/creative tool; not aimed at children (terms require 16+ [adjust]). |
| 8 | Innovative technology | Low | CRDT collaboration and WebAuthn are established; no AI/biometrics (passkeys stay on the device). |
| 9 | Prevents exercising rights / using a service | No | Self-service export and deletion. |
| — | DSK Muss-Liste items (e.g. employee monitoring, location tracking, credit scoring) | No | None applicable. |

## Result

Fewer than two criteria apply → **no DPIA required** for the standard service. Residual risks
(account takeover, over-sharing via links, insider access) are mitigated by the controls in
`docs/SECURITY.md` and `toms.md`.

## Re-assess when

- introducing analytics, AI features on user content, or third-party integrations;
- processing on behalf of public bodies, healthcare or for employee performance monitoring;
- scale grows beyond the threshold above, or hosting moves outside the EU/EEA;
- a significant incident occurs.
