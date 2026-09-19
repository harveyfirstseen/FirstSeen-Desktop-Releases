# FirstSeen Desktop Releases

Public update channel for FirstSeen Desktop installers. This repository contains only update metadata and encoded installer chunks; the FirstSeen application source code and business data are not stored here.

Installed FirstSeen Desktop builds read `latest.json`, download the listed installer chunks, reconstruct the Windows installer locally, verify its exact byte size and SHA-256 checksum, and only then allow installation.
