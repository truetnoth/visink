// Сгенерировано Visink — не править вручную, правки пропадут при следующей сборке.
=== dean ===
-> c1
= entry_first_meeting
-> c1
= c1
ДЕКАН: Садитесь. # id: dean.c1 # speaker: ent_dean
-> c2
= c2
ДЕКАН: Итак, ваша диссертация? # id: dean.c2 # speaker: ent_dean
* [«Почти готова».] -> c3
* {not thesis_changed} [«Я сменил тему».] -> c4
* [Промолчать.] -> c5
= c3
ИГРОК: Почти готова. # id: dean.c3 # speaker: ent_player
-> c6
= c6
ДЕКАН: Посмотрим. # id: dean.c6 # speaker: ent_dean # emotion: cold
-> c8
= c8
-> advisor.entry_office
= c4
ИГРОК: Я сменил тему. # id: dean.c4 # speaker: ent_player
~ thesis_changed = true
-> c6
= c5
~ dean_trust -= 1
-> c7
= c7
ДЕКАН: Молчание — тоже ответ. # id: dean.c7 # speaker: ent_dean # dir: откидывается в кресле
-> DONE
