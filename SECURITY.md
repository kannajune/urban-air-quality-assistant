# Security

## Reporting a problem

Please open a private security advisory on this repository. Do not open a public issue for a
vulnerability.

## How the app protects itself

| Risk                         | Protection                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Leaked credentials           | There are none. The model is reached through a platform binding, not an API key           |
| Injection through form input | Every field is checked against an allow list; unknown fields are dropped                  |
| Prompt injection             | Only validated choices and numbers reach the model, as JSON data, never free text         |
| Malicious model output       | Schema checked, length capped, markup stripped, rendered as text nodes only               |
| Cross site scripting         | Strict content security policy, no inline script or style, no third party code            |
| Clickjacking                 | `X-Frame-Options: DENY` and `frame-ancestors 'none'`                                      |
| Abuse and cost               | Edge rate limit plus exact per visitor and whole app daily ceilings                       |
| Oversized requests           | Bodies are capped at 4 KB                                                                 |
| Slow upstream services       | Every outbound call has a timeout                                                         |
| Privacy                      | Coordinates are rounded to about one kilometre; nothing is stored; no cookies or tracking |
| Error leakage                | Unexpected errors return a generic message; details stay in the server log                |

These protections are covered by tests in `test/hygiene.test.js`, `test/http.test.js`,
`test/worker.test.js` and `test/render.test.js`.
