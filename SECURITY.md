# Security Policy

## Reporting a Vulnerability

If you discover a security issue, please open a GitHub issue and include:

- A clear description of the vulnerability
- Steps to reproduce
- Potential impact

Please avoid posting sensitive proof-of-concept details publicly before a fix is available.

## Scope

This project is a Chrome extension that syncs mouse and scroll interactions between opted-in tabs. Security-sensitive areas include:

- Content script event handling
- Cross-tab message relay
- Permission scope in `manifest.json`
