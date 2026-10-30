# Connection and maintenance UX

This page override responds to user feedback that deployment settings were confusing and too technical for normal use. Keep the existing dark palette, IBM Plex Sans, focus behavior, and responsive navigation from MASTER.md.

## Consumer experience

`#/network` is the connection overview. Existing `#/deploy` links render the same overview. Show network, platform, and wallet state in plain English, with meaningful actions to browse markets, create a question, connect the wallet, retry a connection, or get test QIE. Do not claim a connected wallet has enough gas; balance is a separate condition.

Loading is explicit and does not imply that a contract is missing. A disconnected wallet can browse. Network and deployment failures preserve discovery while stopping dependent writes. Never label a failed verification as ready.

The standard sidebar contains Markets, Portfolio, Watchlist, Create market, How it works, and Resolve markets. Network status lives in the footer. Result review explains that the connected wallet sees only assigned markets and can confirm a result within its market's time window.

## Maintenance experience

`#/developer` contains configuration imports, deployment, diagnostics, artifact digests, and publication instructions. Reach it through a collapsed Advanced options disclosure on the connection page. The current verified connection is shown first. Other operations live in separate, initially collapsed native details elements. New deployments still require the existing review dialog and wallet confirmation.

These disclosures organize complexity; they do not create an authorization boundary. Real resolver permissions remain enforced by the contract, and browser-wallet writes retain session, chain, account, and receipt checks. No admin authentication is claimed or introduced.

## Skill lookup and rationale

UI UX Pro Max semantic searches for progressive disclosure and novice jargon did not return an applicable specific guideline; the jargon query returned no match. Those general UX decisions follow the user's feedback and the task context. Applicable skill matches were confirmation dialogs for irreversible actions and keyboard navigation with visible focus. Keep the irreversible-action review and use native disclosures operable by keyboard. No regenerated design-system fallback was persisted.

## Validation

Inspect desktop and mobile renders. Verify that consumer pages contain no JSON configuration form, artifact hashes, or new-deployment action. Check each advanced disclosure, missing/loading/error/success states, native keyboard operation, actual contract activation, and that opening/closing tools never sends a transaction. Update receipt-recovery browser fixtures to the developer route, with no real transactions.
