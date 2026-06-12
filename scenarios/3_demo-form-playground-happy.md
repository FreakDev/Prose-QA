---
name: demo-form-playground-happy
tags: [example, forms]
url: http://127.0.0.1:8080/playground/form
---

# Goal

Submit the form playground with all standard field types filled in correctly, including the human-check equation captcha.

# Steps

1. Confirm the form playground page has loaded.
2. Enter **Jane Doe** in **Full name**.
3. Enter **jane@example.com** in **Email**.
4. Enter **25** in **Age**.
5. Enter **2026-06-15** in **Contact date**.
6. Select **Engineering** in **Department**.
7. Select radio **Medium** for **Priority**.
8. Check **Email** under **Notify via**.
9. Check **Accept terms**.
10. Enter **Looking forward to the demo.** in **Comments**.
11. Under **Human check**, enter **2** in **A** so that **10 − A + B = 13**.
12. Select radio **5** for **B**.
13. Confirm **Equation satisfied** appears before submitting.
14. Click **Submit**.

# Then

- url contains "/playground/success"
- page shows "Submission successful"
- page shows "Full name: Jane Doe"
- page shows "Department: Engineering"
- page shows "Priority: Medium"
