// Сгенерировано Visink — не править вручную, правки пропадут при следующей сборке.
=== advisor ===
-> a1
= entry_office
-> a1
= a1
НАУЧРУК: Ну что, был у декана? \# не тег \{не условие\} \[не выбор\] /\/ не комментарий \-> не переход # id: advisor.a1 # speaker: ent_advisor
-> a2
= a2
* [Спросить про архив.] -> a3
* {logic >= 3} [Спросить про письмо.] -> a4
+ [Уйти.] -> a5
* -> a12
= a3
ИГРОК: Что в архиве? # id: advisor.a3 # speaker: ent_player
-> a6
= a6
НАУЧРУК: Туда пускают только с допуском. # id: advisor.a6 # speaker: ent_advisor
~ Clues += archive
-> a2
= a4
ИГРОК: Кто прислал письмо? # id: advisor.a4 # speaker: ent_player
-> a7
= a7
НАУЧРУК: Без подписи. Странно, правда? # id: advisor.a7 # speaker: ent_advisor
~ Clues += letter
-> a2
= a5
ИГРОК: Мне пора. # id: advisor.a5 # speaker: ent_player
-> a8
= a8
{ dean_trust < 0:
    -> a9
- else:
    -> a10
}
= a9
НАУЧРУК: Декан на вас зол. # id: advisor.a9 # speaker: ent_advisor
-> a10
= a10
{~Удачи.|Иди уже.|Хватит.}
-> a11
= a11
-> END
= a12
-> a8
