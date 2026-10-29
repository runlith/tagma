---
id: 01a123c2-d0f6-7242-82d0-75aa8e034399
title: One feature declares a settings section, the rest contribute their blocks into it; a second declaration of the same id refuses
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/declaredSections.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SectionRegistry.ts
---
A feature declares a section in its `settings.ts` (`sections`), and puts someone else's block into it with the same file through `contributions` carrying the section id and order; the section shows its contributions through `SectionRegistry.contributionsTo`. Composition gathers the declarations (`app/declaredSections.ts`) and puts them in the `SectionRegistry` port: the settings module loads nothing below features and their files. Two features with one section id, like a contribution to a section nobody declared, refuse at app load: the first names both files, the second names the contributor's file and the section id. Otherwise a second registration would silently push out the first, and the missing section would be hunted by behavior. The `apps` section belongs to the `tagma-apps` feature; app secrets contribute their group into it.
