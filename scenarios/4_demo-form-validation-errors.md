---
name: demo-form-validation-errors
tags: [demo, forms]
url: http://127.0.0.1:8080/playground/form
---

# Goal

Verify the form playground shows server-side validation errors when submitted empty.

# Steps

1. Confirm the form playground page has loaded.
2. Click **Submit** without filling any fields.
3. Confirm validation error messages appear on the page.

# Then

- url contains "/playground/form"
- page shows "Full name is required"
- page shows "Captcha value A is required"
- page shows validation errors for required fields
