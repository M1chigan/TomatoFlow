# 🍅 Tomatoflow

Tomatoflow est une application web de productivité avancée basée sur la méthode Pomodoro. Développée en **JavaScript natif (Vanilla JS)**, elle intègre un gestionnaire de sessions personnalisables, un éditeur de texte synchronisé et un système de streaming audio intelligent avec préchargement asynchrone à latence zéro.

L'objectif de Tomatoflow est d'offrir un espace de travail minimaliste, immersif et entièrement autonome, sans dépendance ni framework lourd.

---

## ✨ Fonctionnalités clés

* **⏱️ Minuteurs Pomodoro par Session :** Créez des sessions de travail indépendantes (ex: *Développement*, *Maths*, *Rédaction*). Contrairement aux applications classiques, chaque session possède sa propre configuration de temps (ex: 25/5 min pour les tâches légères, 55/5 min pour le *deep work*). Les cycles s'enchaînent automatiquement.
* **📝 Éditeur de Notes Persistant :** Un espace de prise de notes avec numérotation dynamique des lignes est intégré au centre. Vos écrits sont sauvegardés automatiquement à chaque frappe dans le `localStorage` et sont liés de manière unique à la session active. Changer de session recharge instantanément vos notes.
* **📻 Streaming Audio Intelligent (Latence Zéro) :** L'application interroge l'API *Radio Browser* pour diffuser des musiques adaptées à votre état (Lofi pour le *Focus*, Jazz pour la *Pause*, Synthwave pour le mode *Boost*). 
* **⚡ Algorithme de Préchargement (Preload) :** Pour éviter les coupures de 3 secondes liées aux requêtes réseau, un script asynchrone va chercher et prépare la radio du cycle suivant 10 secondes avant la fin du minuteur. À la seconde zéro, la transition musicale est instantanée.

---

## 🛠️ Stack Technique

* **HTML5 :** Structure sémantique, modales de configuration et gestion adaptative.
* **CSS3 :** Architecture moderne à 3 panneaux, Flexbox, variables CSS, effets de flou d'arrière-plan (*backdrop-filter*) et animations fluides.
* **JavaScript (ES6+) :** Programmation asynchrone (`fetch`, `Promises`), gestion avancée des intervalles (`setInterval`), manipulation dynamique du DOM et API Audio native.
* **Web Storage API :** Persistance locale intégrale (`localStorage`) des sessions, des temps personnalisés et des notes utilisateur.

---

## 🚀 Installation locale

Aucun serveur ni installation de paquets (`npm`) n'est requis. L'application tourne entièrement côté client.

1. Clonez le dépôt :
   ```bash
   git clone [https://github.com/VOTRE_PSEUDO/tamatoflow.git](https://github.com/VOTRE_PSEUDO/tamatoflow.git)
