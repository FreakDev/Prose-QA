---
name: creation-projet
tags: [pilar]
---

# Goal

tester la creation de projet

# Steps

1. Ouvre la page http://10.0.0.136:3000/projects
2. Vérifie que la liste des projets est visible.
3. Vérifie qu'il y a un bouton bleu avec le label "+ Create new project" en haut à droite de la page
4. En cliquant sur le bouton on doit arriver sur une page de fonulaire
   voici les valeurs a remplir dans le formulaire du projet

---

| npm du projet | projet test SAQ |
| client | incomplete client |
| client contact | Mathias |
| Sponsor | Arnold Liwanag (recherche uniquement le prenom, si besoin) |
| start week | 15 Juin 2026 |
| duration | 5 semaines |
| valeur | 2$ |
| status | l'option "Negotiate SOW" |
| staffing template | the option that contains "with UI" |

---

5. clique sur le bouton save

# Then

l'url de la page doit contenir /project/{id-du-projet} (avec {id-du-project} un chaine de caratères type uuid)
le heading de plus haut niveau dans la page doit être le nom du projet qui vient d'ête créé
