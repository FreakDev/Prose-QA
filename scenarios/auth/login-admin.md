---
name: login-admin
tags: [auth]
url: http://127.0.0.1:8080/login
---

# Goal

Sign in to the demo site as the admin test user so a profile can be provisioned.

# Steps

1. Confirm the sign-in page has loaded.
2. Enter **$PQA_TEST_EMAIL** in the **Email** field.
3. Enter **$PQA_TEST_PASSWORD** in the **Password** field.
4. Click **Sign in**.

# Then

- url does not contain "/login"
- page shows "Projects"
