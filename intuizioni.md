## Idea 1
- però scusa allora non ha neanche senso che gli inviamo gli attributi, basta dargli tecnicamente solo i testi, lui legge i testi e dice clicca su questo testo, poi il codice vede dove c'è quel testo e ricava tutti gli attributi associati per un click preciso o quello che è, che ne pensi?

- Troppo deboluccia, magari c'erano testi duplicati


## Idea 2
- correggimi se mi sbaglio ma noi al momento gli diamo id custom generati da noi giusto invece dei meri e unici attributi dell'elemento vero? Perchè pensavo che potremmo dargli all'LLM solo l'id generato + innerText o innerHTML non so cosa sia meglio e poi in fase di tool call l'id generato viene ritradotto in tutti gli attributi reali di quell'elemento del DOM originale, in questo modo potremmo risparmiare diversi token, non credi? Fa cacare come approccio?

- Mi ha approvato questa idea, ma mi sembra deboluccia, vedi idea 3


## Idea 3
- anche se in realtà è un po una cacata, perchè gli attributi originali gli danno info sul contesto, ma che ne dici di eliminare la soluzione di dargli degli attributi custom e dargli solo tipo max 5 attributi per elemento utile se disponibili, così lui ha contesto 

- Spoiler, ho interrotto l'idea

## Idea 4
- pensavo che però a lui non servono gli attributi, ma il tipo di tag html forse, che dici? Perchè vedo che in quello che arriva sono tutti a, non vorrei facesse confondere l'LLM e pensasse che sono tutti link cliccabili

## Idea 5
- ma si direi così agentId|tagName|text come prima, però il tag name fai si che sia reale e che corrisponda al vero tag html, non tutti a

## Idea 6
- in certi casi per esempio tende a loopare su certe operazioni per molto tempo, per esempio qui andava avanti cercava ferrari, poi formula uno, poi ferrari, poi formula uno e così via, forse dovrebbe farsi delle checkbox come i coding agents?

## Idea 7
- nono l'idea è: DOM/AST (contesto) => LLM lo legge, pensa => hey Playwright clicca l'elemento con testo x e attributi x (per precisione millimetrica)