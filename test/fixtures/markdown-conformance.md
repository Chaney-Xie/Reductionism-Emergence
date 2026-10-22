# ATX Heading 1

## ATX Heading 2

### ATX Heading 3

#### ATX Heading 4

##### ATX Heading 5

###### ATX Heading 6

Setext Heading 1
================

Setext Heading 2
----------------

Soft line one
soft line two  
hard line after two spaces\
hard line after backslash<br>
hard line after safe HTML.


Three source newlines precede this paragraph.

> Outer quote
>
>> Nested quote

---

***

___

1. Ordered item
2. Ordered item
   1. Nested ordered item

- Unordered item
  - Nested unordered item
  
  Continuation paragraph.
- [ ] Incomplete task
- [x] Complete task

Normal *asterisk italic*, _underscore italic_, **asterisk bold**,
__underscore bold__, ***bold italic***, ~~strikethrough~~,
<u>underline</u>, H<sub>2</sub>O, x<sup>2</sup>, and `inline code`.

Nested **bold with *italic* content**, intraword under_score, escaped \*markers\*,
punctuation (**bold**), adjacent **one***two*, and entity &amp;.

[Inline link](https://example.com "Example title") and
[reference link][example] and <https://example.com> and <reader@example.com>.

![Image alt](assets/images/example.png "Image title")

[example]: https://example.com "Reference title"

| Left | Centre | Right | Empty |
|:-----|:------:|------:|-------|
| A | B | C | |
| one | two | three | four |

    const indented = "$not_math$";

```javascript
const formula = "$x^2$";
const value = 1;
```

~~~python
def square(value):
    return value ** 2
~~~

````unknown-language meta stays
code with ``` inside
````

```
plain text
```

Inline formula: $C_6H_{12}O_6$, $Ca^{2+}$, and $\frac{a}{b}$.

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

$$
\begin{aligned}
A + B &\rightarrow C \\
C + D &\rightleftharpoons E
\end{aligned}
$$

$$
\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}
$$

$$
\pu{37 ^\circ C}
$$

Invalid formula remains editable: $\frac{a}{$.

<script>alert("must not execute")</script>

Empty constructs: **** `` []().
