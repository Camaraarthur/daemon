# Domanda di Brevetto per Invenzione Industriale
## Dispositivo elettronico con indicatore visivo passivo di attivazione sensore a garanzia di privacy

**Inventore:** Arthur Camara
**Data di redazione:** 6 aprile 2026

---

## TITOLO

Dispositivo elettronico con elemento indicatore visivo passivo collegato in serie al percorso di alimentazione di un elemento sensore per la garanzia hardware di privacy

---

## DESCRIZIONE

### Campo tecnico dell'invenzione

La presente invenzione si riferisce al campo dei dispositivi elettronici dotati di sensori quali microfoni, telecamere e simili, e in particolare a un sistema di indicazione hardware che garantisce fisicamente la visibilità dello stato di attivazione del sensore, senza possibilità di elusione tramite software, firmware o componenti elettronici attivi.

### Stato della tecnica e suoi limiti

I dispositivi elettronici moderni — tra cui smartphone, altoparlanti intelligenti, assistenti vocali, dispositivi indossabili e dispositivi IoT — integrano comunemente sensori quali microfoni e telecamere in grado di acquisire informazioni sensibili e private, incluse conversazioni, immagini, video e dati di localizzazione.

Per indicare all'utente l'attivazione di tali sensori, lo stato della tecnica prevede diverse soluzioni:

**Indicatori controllati via software.** La maggior parte dei dispositivi attuali utilizza indicatori LED o indicatori su schermo controllati dal sistema operativo o dal firmware del dispositivo. Tali soluzioni presentano una vulnerabilità fondamentale: essendo controllate da software, possono essere eluse da malware, exploit di firmware, errori di programmazione o modifiche intenzionali del produttore. Un esempio noto è il caso documentato nel 2013 da ricercatori della Johns Hopkins University, che dimostrarono la possibilità di attivare la telecamera dei computer portatili MacBook senza accendere il LED indicatore, sfruttando una vulnerabilità nel firmware del microcontrollore della telecamera.

**Circuiti con componenti attivi.** Il brevetto US11490248B2 (Bose Corporation, concesso 2022) descrive un sistema di indicazione privacy per dispositivi audio wireless che utilizza transistor (componenti elettronici attivi Q1, Q3) per accoppiare lo stato di un LED a quello dell'alimentazione del microfono. In tale sistema, il LED indica che il microfono è disattivato (modalità privacy), non che è attivo, e un circuito di controllo con pin dedicato seleziona tra la modalità attiva e la modalità privacy. Sebbene tale soluzione impedisca il controllo software diretto del LED, la presenza di transistor e di un circuito di controllo nel percorso di alimentazione introduce componenti attivi che possono, in linea di principio, essere riprogrammati, sostituiti o bypassati mediante intervento su componenti discreti. Inoltre, l'indicazione della modalità privacy (LED acceso quando il microfono è spento) è funzionalmente opposta all'indicazione di attivazione (LED acceso quando il microfono è acceso).

**Chip di privacy dedicati.** Alcuni dispositivi, come il Humane AI Pin, utilizzano un chip dedicato ("Trust Light") per controllare l'indicatore di privacy. Tale soluzione, pur essendo più sicura del controllo software diretto, rimane dipendente dal firmware del chip dedicato e può quindi essere elusa mediante attacchi al firmware.

**Interruttori hardware.** Dispositivi come il Purism Librem e il PinePhone utilizzano interruttori fisici che disconnettono completamente il microfono. Tali soluzioni forniscono un controllo affidabile ma non offrono un'indicazione visiva dello stato di attivazione: l'utente deve ricordare la posizione dell'interruttore o verificarla manualmente.

Nessuna delle soluzioni note nello stato della tecnica combina le seguenti proprietà: (i) indicazione visiva garantita quando il sensore è alimentato, (ii) assenza totale di componenti elettronici attivi nel percorso di alimentazione tra sorgente e sensore, e (iii) evidenza di manomissione verificabile in caso di tentativo di bypass.

### Sintesi dell'invenzione e soluzione del problema tecnico

La presente invenzione risolve i problemi sopra descritti fornendo un dispositivo elettronico in cui un elemento indicatore visivo passivo — tipicamente un diodo a emissione luminosa (LED) — è collegato elettricamente in serie con il conduttore di alimentazione di un elemento sensore, in modo tale che la corrente elettrica necessaria ad alimentare il sensore debba necessariamente fluire attraverso l'indicatore visivo.

L'invenzione si caratterizza per l'assenza di qualsiasi componente elettronico attivo (transistor, microcontrollori, circuiti integrati, relè) nel percorso di alimentazione tra la sorgente di energia e l'elemento sensore. La relazione tra indicatore e sensore è imposta esclusivamente dalla topologia del circuito elettrico e dalla fisica della conduzione: l'indicatore visivo passivo deve essere polarizzato in modo diretto (e dunque emettere luce) affinché la corrente possa raggiungere il sensore.

Tale configurazione garantisce che:

1. L'indicatore visivo è attivo quando, e solo quando, il sensore riceve alimentazione.
2. Nessun software, firmware, malware o exploit può disattivare l'indicatore mantenendo il sensore attivo, in quanto non esistono componenti attivi nel percorso di alimentazione che possano essere riprogrammati o sfruttati.
3. Qualsiasi tentativo di bypassare l'indicatore visivo richiede una modifica fisica del circuito stampato (ad esempio, un ponte di saldatura tra i pad dell'indicatore o l'aggiunta di un conduttore di bypass), che è rilevabile mediante ispezione visiva.

### Breve descrizione dei disegni

**Figura 1:** Schema elettrico del circuito di interblocco privacy, mostrante il collegamento in serie dell'elemento indicatore visivo passivo con l'alimentazione dell'elemento sensore.

**Figura 2:** Vista del layout del circuito stampato (PCB), mostrante la traccia in rame che collega la sorgente di alimentazione, l'elemento indicatore visivo passivo e l'elemento sensore.

**Figura 3:** Schema a blocchi del dispositivo elettronico completo, mostrante la posizione del circuito di interblocco privacy nel contesto del sistema complessivo.

### Descrizione dettagliata di una forma di realizzazione preferita

Con riferimento alla Figura 1, il dispositivo elettronico (100) comprende:

- una sorgente di alimentazione (110) che fornisce una tensione continua, tipicamente 3,3 V, attraverso un regolatore lineare;
- un filtro EMI (120), realizzato mediante una perla di ferrite (FB2, BLM18AG601SN1, circa 600 Ω a 100 MHz), collegato alla sorgente di alimentazione;
- un conduttore di alimentazione (130), realizzato come traccia in rame su circuito stampato (PCB), che collega l'uscita del filtro EMI a un nodo di alimentazione denominato MIC_VDD;
- un resistore di limitazione corrente (R56, 1 kΩ, formato 0402 SMD), collegato al nodo MIC_VDD;
- un elemento indicatore visivo passivo (LED6), realizzato come diodo a emissione luminosa rosso (formato 0402, LED_0402_1005Metric), il cui anodo è collegato al resistore R56 e il cui catodo è collegato alla massa (GND);
- almeno un elemento sensore (U13), realizzato come microfono MEMS omnidirezionale digitale (INMP441, interfaccia I2S), il cui terminale di alimentazione (VDD) è collegato al medesimo nodo MIC_VDD.

Il funzionamento del circuito è il seguente: quando la sorgente di alimentazione (110) è attiva, la corrente fluisce attraverso il filtro EMI (120), lungo il conduttore di alimentazione (130) fino al nodo MIC_VDD. Da questo nodo, la corrente si divide in due percorsi paralleli:

(a) attraverso il resistore R56 e il LED6 verso la massa, polarizzando il LED in modo diretto e causandone l'emissione di luce rossa;

(b) attraverso il terminale VDD del microfono INMP441 (U13), alimentando il microfono.

Poiché il LED6 e il microfono U13 condividono il medesimo nodo di alimentazione MIC_VDD, ed essendo il LED6 collegato in serie con il resistore R56 tra detto nodo e la massa, la condizione necessaria e sufficiente per l'attivazione del LED è la presenza di tensione sul nodo MIC_VDD — la medesima condizione necessaria per l'alimentazione del microfono.

In modo equivalente: se il LED6 non è acceso, il nodo MIC_VDD non è alimentato, e dunque il microfono non può operare. Se il microfono opera, il nodo MIC_VDD è necessariamente alimentato, e dunque il LED6 è necessariamente acceso.

**Punto operativo elettrico:** Con una tensione di alimentazione di 3,3 V, il LED rosso presenta una caduta di tensione diretta tipica di circa 1,8 V. La corrente attraverso il LED e il resistore R56 è dunque (3,3 V - 1,8 V) / 1 kΩ ≈ 1,5 mA, sufficiente per una luminosità visibile in condizioni ambientali normali. Il microfono INMP441 assorbe circa 1,4 mA con una tensione operativa minima di 1,8 V e massima di 3,3 V, pienamente compatibile con la tensione disponibile al nodo MIC_VDD.

**Aspetto anti-manomissione:** L'elemento indicatore visivo passivo LED6 è montato su pad SMD (surface-mount device) sulla traccia in rame del circuito stampato. Qualsiasi tentativo di bypassare il LED6 richiede una delle seguenti azioni, ciascuna rilevabile mediante ispezione visiva:

(i) saldatura di un ponte (solder bridge) tra i pad anodico e catodico del LED6;
(ii) taglio della traccia in rame e aggiunta di un conduttore di bypass;
(iii) rimozione del LED6 e ponte dei pad con saldatura.

In tutti i casi, la modifica è fisicamente visibile e può essere verificata mediante semplice ispezione visiva o mediante misura elettrica con un multimetro.

Nella forma di realizzazione preferita, il dispositivo comprende inoltre un secondo elemento indicatore visivo passivo (LED7), di caratteristiche identiche al primo, collegato al medesimo nodo MIC_VDD tramite un secondo resistore di limitazione corrente (R57, 1 kΩ), per garantire la visibilità dell'indicazione da angolazioni diverse del dispositivo.

Nella forma di realizzazione preferita, il dispositivo comprende inoltre un secondo elemento sensore (U24), anch'esso un microfono MEMS INMP441, collegato al medesimo nodo MIC_VDD, condividendo pertanto il medesimo interblocco di privacy.

### Applicabilità industriale

L'invenzione trova applicazione in qualsiasi dispositivo elettronico dotato di sensori in grado di acquisire dati sensibili, tra cui in particolare:

- dispositivi indossabili per assistenza AI con ascolto continuo dell'ambiente;
- altoparlanti intelligenti e assistenti vocali domestici;
- telecamere di sicurezza e dispositivi di videosorveglianza;
- computer portatili e smartphone;
- dispositivi IoT (Internet of Things) con microfoni o telecamere;
- dispositivi medicali con sensori biometrici;
- sistemi di videoconferenza.

L'invenzione è particolarmente vantaggiosa per i dispositivi indossabili configurati per l'acquisizione continua di audio ambientale (always-listening devices), nei quali la garanzia di privacy è di importanza critica per l'accettazione da parte dell'utente e la conformità normativa.

---

## RIVENDICAZIONI

1. Dispositivo elettronico comprendente un elemento sensore (U13) che richiede alimentazione elettrica per funzionare e un conduttore di alimentazione (130) per detto elemento sensore, caratterizzato dal fatto che un elemento indicatore visivo passivo (LED6) è collegato elettricamente in serie con detto conduttore di alimentazione di detto elemento sensore, in modo tale che la corrente elettrica che alimenta detto elemento sensore fluisca attraverso detto elemento indicatore visivo passivo; e in cui detto conduttore di alimentazione è privo di componenti elettronici attivi tra detto elemento indicatore visivo passivo e detto elemento sensore, per cui detto elemento indicatore visivo passivo produce un'indicazione visiva percepibile dall'uomo quando, e solo quando, detto elemento sensore riceve potenza operativa.

2. Dispositivo secondo la rivendicazione 1, in cui detto elemento indicatore visivo passivo è un diodo a emissione luminosa (LED).

3. Dispositivo secondo la rivendicazione 1, in cui detto elemento sensore è un microfono.

4. Dispositivo secondo la rivendicazione 3, in cui detto microfono è un microfono MEMS (micro-electromechanical systems) digitale.

5. Dispositivo secondo la rivendicazione 1, in cui detto elemento sensore, detto elemento indicatore visivo passivo e detto conduttore di alimentazione sono disposti su un medesimo circuito stampato (PCB).

6. Dispositivo secondo la rivendicazione 5, in cui detto elemento indicatore visivo passivo è montato su pad a montaggio superficiale di detto circuito stampato, e in cui il bypass di detto elemento indicatore visivo passivo richiede una modifica fisica di detto circuito stampato rilevabile mediante ispezione visiva.

7. Dispositivo secondo la rivendicazione 1, in cui detto dispositivo elettronico è un dispositivo indossabile configurato per l'acquisizione continua di audio ambientale.

8. Dispositivo secondo la rivendicazione 5, in cui detto conduttore di alimentazione è una traccia in rame su detto circuito stampato, e detto elemento indicatore visivo passivo è saldato a detta traccia in rame in modo tale che la rimozione di detto elemento indicatore visivo passivo crei un circuito aperto in detto conduttore di alimentazione.

9. Dispositivo secondo la rivendicazione 1, in cui detto elemento indicatore visivo passivo ha una caduta di tensione diretta compresa nell'intervallo di tensione operativa accettabile di detto elemento sensore.

10. Gruppo circuito stampato comprendente: un componente microfono (U13) montato su un circuito stampato; un diodo a emissione luminosa (LED6) montato su detto circuito stampato e collegato elettricamente in serie su una traccia di alimentazione di detto circuito stampato tra un collegamento a una sorgente di alimentazione e un terminale di ingresso di alimentazione di detto componente microfono; in cui nessun componente elettronico attivo è disposto su detta traccia di alimentazione tra detto collegamento alla sorgente di alimentazione e detto terminale di ingresso di alimentazione; e in cui detto diodo a emissione luminosa è configurato per emettere luce visibile quando polarizzato direttamente dalla corrente che fluisce verso detto componente microfono.

---

## CLAIMS (English Translation)

1. An electronic device comprising a sensor element (U13) requiring electrical power to operate and a power supply conductor (130) for said sensor element, characterized in that a passive visual indicator element (LED6) is electrically connected in series with said power supply conductor of said sensor element, such that electrical current supplying power to said sensor element flows through said passive visual indicator element; and wherein said power supply conductor is free of active electronic components between said passive visual indicator element and said sensor element, whereby said passive visual indicator element produces a human-perceptible visual indication when, and only when, said sensor element is receiving operating power.

2. The device of claim 1, wherein said passive visual indicator element is a light-emitting diode (LED).

3. The device of claim 1, wherein said sensor element is a microphone.

4. The device of claim 3, wherein said microphone is a micro-electromechanical systems (MEMS) digital microphone.

5. The device of claim 1, wherein said sensor element, said passive visual indicator element, and said power supply conductor are disposed on a common printed circuit board (PCB).

6. The device of claim 5, wherein said passive visual indicator element is mounted on surface-mount pads of said printed circuit board, and wherein bypassing said passive visual indicator element requires a physical modification to said printed circuit board that is detectable by visual inspection.

7. The device of claim 1, wherein said electronic device is a wearable device configured for continuous ambient audio capture.

8. The device of claim 5, wherein said power supply conductor is a copper trace on said printed circuit board, and said passive visual indicator element is soldered to said copper trace such that removal of said passive visual indicator element creates an open circuit in said power supply conductor.

9. The device of claim 1, wherein said passive visual indicator element has a forward voltage drop that is within an acceptable operating voltage range of said sensor element.

10. A printed circuit board assembly comprising: a microphone component (U13) mounted on a printed circuit board; a light-emitting diode (LED6) mounted on said printed circuit board and electrically connected in series on a power supply trace of said printed circuit board between a power source connection and a power input terminal of said microphone component; wherein no active electronic components are disposed on said power supply trace between said power source connection and said power input terminal; and wherein said light-emitting diode is configured to emit visible light when forward-biased by current flowing to said microphone component.

---

## RIASSUNTO

Dispositivo elettronico comprendente un elemento sensore e un elemento indicatore visivo passivo collegato elettricamente in serie con il conduttore di alimentazione dell'elemento sensore. L'elemento indicatore visivo passivo, tipicamente un diodo a emissione luminosa, è attraversato dalla corrente di alimentazione del sensore e produce un'indicazione visiva quando, e solo quando, il sensore riceve alimentazione. Il conduttore di alimentazione è privo di componenti elettronici attivi tra l'indicatore e il sensore, garantendo che nessun software, firmware o exploit possa disattivare l'indicazione mantenendo il sensore operativo. Nella forma di realizzazione preferita, l'indicatore e il sensore sono disposti su un medesimo circuito stampato, e qualsiasi tentativo di bypass richiede una modifica fisica rilevabile mediante ispezione visiva. L'invenzione trova particolare applicazione in dispositivi indossabili con microfoni per ascolto ambientale continuo.

---

## ABSTRACT (English)

An electronic device comprising a sensor element and a passive visual indicator element electrically connected in series with the power supply conductor of the sensor element. The passive visual indicator element, typically a light-emitting diode, is traversed by the sensor's supply current and produces a visual indication when, and only when, the sensor receives power. The power supply conductor is free of active electronic components between the indicator and the sensor, ensuring that no software, firmware, or exploit can deactivate the indication while maintaining the sensor operational. In a preferred embodiment, the indicator and sensor are disposed on a common printed circuit board, and any bypass attempt requires a physical modification detectable by visual inspection. The invention finds particular application in wearable devices with microphones for continuous ambient audio capture.

---

## NOTE PER I DISEGNI

Esportare da KiCad i seguenti disegni:

1. **Figura 1:** Schema elettrico (schematic) — isolare la sezione del circuito che mostra: sorgente 3V3_SYS → FB2 → nodo MIC_VDD → R56 → LED6 → GND, e nodo MIC_VDD → U13 (INMP441) VDD. Rimuovere tutti gli altri componenti non pertinenti. Aggiungere numeri di riferimento (110, 120, 130, LED6, R56, U13).

2. **Figura 2:** Layout PCB — vista dall'alto mostrante la traccia in rame dal nodo di alimentazione attraverso i pad del LED fino al microfono. Evidenziare la traccia di alimentazione condivisa.

3. **Figura 3:** Schema a blocchi semplificato — sorgente di alimentazione → filtro EMI → [nodo condiviso] → LED (verso GND) / Microfono (verso sistema audio). Mostrare che non esistono componenti attivi nel percorso.

**Requisiti formali per i disegni:**
- Linee nere su fondo bianco
- Formato A4 (29,7 x 21 cm)
- Margini minimo 2,5 cm su tutti i lati
- Nessun testo nei disegni eccetto numeri di riferimento e "Fig. 1", "Fig. 2", "Fig. 3"
- Qualità sufficiente per la riproduzione
