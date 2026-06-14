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
5. Set **Contact date** to **2026-06-15** on the "contact date" input (fill the field directly; do not open the calendar picker).
6. Confirm **Contact date** is **2026-06-15** before continuing.
7. Select **Engineering** in **Department**.
8. Select radio **Medium** for **Priority**.
9. Check **Email** under **Notify via**.
10. Check **Accept terms**.
11. Enter **Looking forward to the demo.** in **Comments**.
12. Under **Human check**, enter **2** in **A** so that **10 − A + B = 13**.
13. Select radio **5** for **B**.
14. Confirm **Equation satisfied** appears before submitting.
15. Click **Submit**.

# Then

- url contains "/playground/success"
- page shows "Submission successful"
- page shows "Full name: Jane Doe"
- page shows "Email: jane@example.com"
- page shows "Age: 25"
- page shows "Contact date: 2026-06-15"
- page shows "Department: Engineering"
- page shows "Priority: Medium"
- page shows "Notify via: Email"
- page shows "Comments: Looking forward to the demo."
