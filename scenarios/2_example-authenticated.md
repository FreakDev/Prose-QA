---
name: example-authenticated
tags: [demo]
auth: admin
url: http://127.0.0.1:8080/projects
---

# Goal

As a signed-in user, open the protected projects page without performing login in this scenario.

# Steps

1. Confirm the projects page has loaded.

# Then

- url contains "/projects"
- page shows "You are viewing a protected page."
- page shows "Welcome, demo@pqa.local"
