---
name: login-admin
tags: [auth, example]
url: https://app.example.com/login
---

# Goal

Authenticate as an admin test user. This scenario is not run in batch — it runs on demand when a consumer scenario needs `auth: admin`.

# Steps

1. Open the login page.
2. Sign in using `$PQA_TEST_EMAIL` and `$PQA_TEST_PASSWORD` from the environment.
3. Confirm you reach an authenticated area (dashboard or home).

# Then

- url does not contain "/login"
