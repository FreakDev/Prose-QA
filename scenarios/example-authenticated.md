---
name: example-authenticated
tags: [smoke, example, auth-demo]
auth: admin
url: http://127.0.0.1:8080/projects
---

# Goal

Verify that an authenticated user can load a protected page.

# Steps

1. Confirm the projects page has loaded.

# Then

- url contains "/projects"
- page shows "Welcome"
