# MeshCentral for Cloudron

MeshCentral manages computers through a web browser. This unofficial package uses PostgreSQL, outbound mail, and TLS from Cloudron.

Install it from the Cloudron dashboard. Open App Store, choose Add custom app, then Community app, and paste this address:

```text
https://raw.githubusercontent.com/paramedicspecialist/meshcentral-cloudron/main/CloudronVersions.json
```

Open the app and create the first account with Cloudron sign-in. That person is the site administrator. My Users and My Server appear under their name. New local accounts are already turned off when Cloudron sign-in is on. A second person who signs in before the app restarts also becomes a site administrator.

Do not put the domain behind Cloudflare if agents must connect.

Intel AMT is optional and off. Turn on the Intel AMT MPS port in the app location settings only if you use Intel AMT.

Data is stored in `/app/data/meshcentral-data` and `/app/data/meshcentral-files`.

The package version is the MeshCentral version.

## Licence

MeshCentral is copyright 2017–2025 Intel Corporation and is licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

This repository is an unofficial Cloudron package. It is not published by Intel or the MeshCentral project. The startup scripts are separate from MeshCentral. The image is built from the official `ghcr.io/ylianst/meshcentral` image, which includes MeshCentral's licence.
