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

1. Dispositivo elettronico comprendente: un elemento sensore configurato per acquisire dati ambientali; un elemento indicatore percepibile dall'uomo; e un circuito di alimentazione che fornisce potenza elettrica all'elemento sensore; caratterizzato dal fatto che l'elemento indicatore è accoppiato elettricamente al circuito di alimentazione in modo tale che l'elemento indicatore è necessariamente attivato quando l'elemento sensore riceve potenza elettrica, e in cui l'accoppiamento elettrico tra l'elemento indicatore e il circuito di alimentazione è privo di elementi di commutazione controllabili elettronicamente, cosicché lo stato di attivazione dell'elemento indicatore non può essere alterato indipendentemente dallo stato di alimentazione dell'elemento sensore mediante alcun segnale di controllo elettronico.

2. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore è collegato in serie in un percorso di corrente del circuito di alimentazione verso l'elemento sensore, cosicché la corrente che alimenta l'elemento sensore fluisce attraverso l'elemento indicatore.

3. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore e l'elemento sensore sono collegati in parallelo su un medesimo nodo di alimentazione, e in cui non esiste alcun percorso di alimentazione controllabile indipendentemente verso l'elemento indicatore o verso l'elemento sensore.

4. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore comprende un diodo a emissione luminosa (LED).

5. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore comprende un indicatore acustico.

6. Dispositivo secondo la rivendicazione 1, in cui l'elemento sensore comprende un microfono.

7. Dispositivo secondo la rivendicazione 6, in cui il microfono è un microfono MEMS (micro-electromechanical systems).

8. Dispositivo secondo la rivendicazione 1, in cui l'elemento sensore comprende un sensore di immagine.

9. Dispositivo secondo la rivendicazione 1, in cui il dispositivo è un dispositivo indossabile.

10. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore e l'elemento sensore sono disposti su un circuito stampato (PCB), e in cui una traccia conduttiva su detto circuito stampato collega elettricamente l'elemento indicatore e l'elemento sensore al circuito di alimentazione senza passare attraverso alcun elemento di commutazione controllabile elettronicamente.

11. Dispositivo secondo la rivendicazione 2, in cui la rimozione o la disconnessione dell'elemento indicatore interrompe il circuito di alimentazione verso l'elemento sensore.

12. Dispositivo secondo la rivendicazione 1, in cui l'accoppiamento elettrico tra l'elemento indicatore e il circuito di alimentazione è costituito interamente da componenti elettrici passivi e interconnessioni conduttive.

13. Dispositivo secondo la rivendicazione 1, in cui l'elemento indicatore è posizionato su una superficie esterna del dispositivo visibile all'utente durante il normale funzionamento del dispositivo.

14. Gruppo circuito stampato comprendente: un elemento microfono avente un terminale di ingresso di alimentazione; un elemento indicatore luminoso avente un primo e un secondo terminale; un conduttore di alimentazione su detto circuito stampato; in cui l'elemento indicatore luminoso e l'elemento microfono sono collegati elettricamente al conduttore di alimentazione in modo tale che la corrente elettrica che fluisce verso l'elemento microfono debba anche fluire attraverso o verso l'elemento indicatore luminoso, e in cui non esiste alcun elemento di commutazione controllabile elettronicamente in alcun percorso elettrico tra il conduttore di alimentazione e l'elemento microfono o l'elemento indicatore luminoso, cosicché l'elemento indicatore luminoso non può essere disattivato mentre l'elemento microfono rimane alimentato.

15. Procedimento per fornire un'indicazione anti-manomissione dell'attivazione di un sensore in un dispositivo elettronico, comprendente: predisporre un elemento sensore e un elemento indicatore percepibile dall'uomo su un medesimo circuito elettrico di alimentazione, detto circuito elettrico di alimentazione essendo privo di qualsiasi elemento di commutazione controllabile elettronicamente tra una sorgente di alimentazione e l'elemento sensore o l'elemento indicatore; per cui l'attivazione dell'elemento sensore causa necessariamente l'attivazione dell'elemento indicatore, e la disattivazione dell'elemento indicatore causa necessariamente la disattivazione dell'elemento sensore, senza possibilità di controllo indipendente mediante firmware, software o segnale di controllo elettronico.

---

## CLAIMS (English Translation)

1. An electronic device comprising: a sensor element configured to capture environmental data; a human-perceptible indicator element; and a power supply circuit supplying electrical power to the sensor element; characterized in that the indicator element is electrically coupled to the power supply circuit such that the indicator element is necessarily activated when the sensor element is receiving electrical power, and wherein the electrical coupling between the indicator element and the power supply circuit is free of electronically controllable switching elements, such that the activation state of the indicator element cannot be altered independently of the power state of the sensor element by any electronic control signal.

2. The device of claim 1, wherein the indicator element is connected in series in a current path of the power supply circuit to the sensor element, such that current supplying the sensor element flows through the indicator element.

3. The device of claim 1, wherein the indicator element and the sensor element are connected in parallel on a common power supply node, and wherein no independently controllable power path exists to either the indicator element or the sensor element.

4. The device of claim 1, wherein the indicator element comprises a light-emitting diode (LED).

5. The device of claim 1, wherein the indicator element comprises an audible indicator element.

6. The device of claim 1, wherein the sensor element comprises a microphone.

7. The device of claim 6, wherein the microphone is a micro-electromechanical systems (MEMS) microphone.

8. The device of claim 1, wherein the sensor element comprises an image sensor.

9. The device of claim 1, wherein the device is a wearable device.

10. The device of claim 1, wherein the indicator element and the sensor element are disposed on a printed circuit board (PCB), and wherein a conductive trace on said printed circuit board electrically connects the indicator element and the sensor element to the power supply circuit without passing through any electronically controllable switching element.

11. The device of claim 2, wherein removal or disconnection of the indicator element interrupts the power supply circuit to the sensor element.

12. The device of claim 1, wherein the electrical coupling between the indicator element and the power supply circuit consists entirely of passive electrical components and conductive interconnects.

13. The device of claim 1, wherein the indicator element is positioned on an external surface of the device visible to a user during normal operation of the device.

14. A printed circuit board assembly comprising: a microphone element having a power input terminal; a light-emitting indicator element having first and second terminals; a power supply conductor on the printed circuit board; wherein the light-emitting indicator element and the microphone element are electrically connected to the power supply conductor such that electrical current flowing to the microphone element must also flow through or to the light-emitting indicator element, and wherein no electronically controllable switching element exists in any electrical path between the power supply conductor and either of the microphone element or the light-emitting indicator element, such that the light-emitting indicator element cannot be deactivated while the microphone element remains powered.

15. A method of providing a tamper-evident indication of sensor activation in an electronic device, the method comprising: providing a sensor element and a human-perceptible indicator element on a common electrical power circuit, the common electrical power circuit being free of any electronically controllable switching element between a power source and either the sensor element or the indicator element; whereby activation of the sensor element necessarily causes activation of the indicator element, and deactivation of the indicator element necessarily causes deactivation of the sensor element, without the possibility of independent control by any firmware, software, or electronic control signal.

---

## RIASSUNTO

Dispositivo elettronico comprendente un elemento sensore e un elemento indicatore percepibile dall'uomo accoppiato elettricamente al circuito di alimentazione dell'elemento sensore. L'accoppiamento è privo di elementi di commutazione controllabili elettronicamente, cosicché l'elemento indicatore è necessariamente attivato quando il sensore riceve alimentazione, e il suo stato non può essere alterato indipendentemente dallo stato di alimentazione del sensore mediante alcun segnale di controllo elettronico, firmware o software. L'accoppiamento può essere realizzato in serie (la corrente verso il sensore fluisce attraverso l'indicatore) o in parallelo su un nodo di alimentazione comune privo di percorsi controllabili indipendentemente. Nella forma di realizzazione preferita, l'indicatore e il sensore sono disposti su un circuito stampato. L'invenzione trova particolare applicazione in dispositivi indossabili con microfoni per ascolto ambientale continuo.

---

## ABSTRACT (English)

An electronic device comprising a sensor element and a human-perceptible indicator element electrically coupled to the power supply circuit of the sensor element. The coupling is free of electronically controllable switching elements, such that the indicator element is necessarily activated when the sensor receives power, and its activation state cannot be altered independently of the sensor's power state by any electronic control signal, firmware, or software. The coupling may be implemented in series (current to the sensor flows through the indicator) or in parallel on a common power node with no independently controllable paths. In a preferred embodiment, the indicator and sensor are disposed on a printed circuit board. The invention finds particular application in wearable devices with microphones for continuous ambient audio capture.

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
