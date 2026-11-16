// Idiomas de salida. Inglés y hebreo: traducción normal.
// Quechua, aymara y guaraní: BORRADOR, hay que validarlo con hablantes antes de la demo.
export const IDIOMAS = {
  es: { nombre: 'Castellano', voz: 'es', sr: 'es-BO' },
  qu: { nombre: 'Quechua', voz: null, sr: null, validar: true },
  ay: { nombre: 'Aymara', voz: null, sr: null, validar: true },
  gn: { nombre: 'Guaraní', voz: null, sr: null, validar: true },
  en: { nombre: 'English', voz: 'en', sr: 'en-US' },
  he: { nombre: 'עברית · Hebreo', voz: 'he', sr: 'he-IL', rtl: true },
};

//            español        inglés            hebreo            quechua                 aymara                guaraní
const T = `
hola         | hello           | שלום            | imaynalla            | kamisaki            | mba'éichapa
gracias      | thank you       | תודה            | sulpayki             | yuspagara           | aguyje
por favor    | please          | בבקשה           | ama hina kaspa       | uk'amaki            | ikatúpa
sí           | yes             | כן              | arí                  | jisa                | heẽ
no           | no              | לא              | mana                 | janiwa              | nahániri
no entiendo  | I don't understand | אני לא מבין  | mana unanchanichu    | janiw amuykti       | ndaikumbýi
repita       | please repeat   | תחזור בבקשה     | wakmanta niy         | mayamp sita         | ere jey
más despacio | slower, please  | יותר לאט        | allillamanta         | k'achata            | mbeguekatu
pregunta     | I have a question | יש לי שאלה    | tapuy                | jiskt'a             | porandu
ayuda        | help            | עזרה            | yanapay              | yanapa              | pytyvõ
baño         | bathroom        | שירותים         | hisp'ana             | baño                | baño
dolor        | pain            | כאב             | nanay                | usu                 | hasy
agua         | water           | מים             | yaku                 | uma                 | y
médico       | doctor          | רופא            | hampiq               | qulliri             | pohanohára
emergencia   | emergency       | חירום           | usqhay               | jank'aki            | pya'e
profesor     | teacher         | מורה            | yachachiq            | yatichiri           | mbo'ehára
terminé      | I'm done        | סיימתי          | tukuniña             | tukuyta             | amohu'ãma
tarea        | homework        | שיעורי בית      | ruwana               | luraña              | tembiapo
examen       | exam            | מבחן            | yachay tupuy         | yant'a              | ñeha'ã
escribir     | write           | לכתוב           | qillqay              | qillqaña            | jehai
leer         | read            | לקרוא           | ñawinchay            | liyiña              | moñe'ẽ
bien         | good            | טוב             | allin                | walikiwa            | iporã
mal          | bad             | רע              | mana allin           | janiw walikiti      | ivai
perdón       | sorry           | סליחה           | pampachaway          | pampachita          | ñyrõ
qué          | what            | מה              | ima                  | kuna                | mba'e
cómo         | how             | איך             | imayna               | kunjama             | mba'éicha
dónde        | where           | איפה            | maypi                | kawki               | moõ
nombre       | name            | שם              | suti                 | suti                | téra
mamá         | mom             | אמא             | mama                 | tayka               | sy
papá         | dad             | אבא             | tata                 | tata                | túva
yo           | I               | אני             | ñuqa                 | naya                | che
buenos días  | good morning    | בוקר טוב        | allin p'unchay       | suma uru            | mba'éichapa ne pyhareve
mi           | my              | שלי             | -                    | -                   | che
es           | is              | -               | -                    | -                   | -
trabajo      | work            | עבודה           | llank'ay             | irnaqaña            | -
vivo         | I live          | אני גר          | tiyani               | -                   | aiko
abogado      | lawyer          | עורך דין        | -                    | -                   | -
electricista | electrician     | חשמלאי          | -                    | -                   | -
policía      | police officer  | שוטר            | -                    | -                   | -
presidente   | president       | נשיא            | -                    | -                   | -
La Paz       | La Paz          | לה פאס          | Chuqiyapu            | Chuqi Yapu          | -
Sucre        | Sucre           | סוקרה           | -                    | -                   | -
Cochabamba   | Cochabamba      | קוצ'במבה        | Quchapampa           | -                   | -
`;
const ORDEN = ['es', 'en', 'he', 'qu', 'ay', 'gn'];
export const TRAD = {};
for (const linea of T.trim().split('\n')) {
  const c = linea.split('|').map(s => s.trim());
  if (c.length !== 6) continue;
  TRAD[c[0]] = Object.fromEntries(ORDEN.map((l, i) => [l, c[i]]).filter(([, v]) => v !== '-'));   // «-» = sin traducción: se deja en castellano
}

export const traducir = (palabra, lang) => (lang === 'es' ? palabra : TRAD[palabra]?.[lang]) || palabra;

// Para el modo Profesor: frases en el idioma elegido que llevan a cada seña.
export const alias = lang => lang === 'es' ? [] : Object.entries(TRAD).filter(([, t]) => t[lang]).map(([es, t]) => [t[lang], es]);
