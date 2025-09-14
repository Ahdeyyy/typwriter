export const typst_example = `
  #set text(
  font: "Times New Roman",
  size: 12pt,
)

#set par(
  first-line-indent: 1em,
  spacing: 0.85em,
  justify: false
)
#set heading(
  numbering: "1.",
)
#set page(
  margin: 1in,
  numbering: "1",
  number-align: top + right,
  columns: 1
)
#set document(
  author: "Adeala Adegbulugbe",
  title: "Dynamic Markdown Text Formatter Using the Decorator Design Pattern",
)



#show heading.where(
  level: 1
): it => block(width: 100%)[
  #set align(center)
  #set text(16pt, weight: "bold", font: "Rockwell")
  #smallcaps(it.body)
]

#show heading.where(
  level: 2
): it => block(width: 100%)[
  #set align(left)
  #set text(15pt, weight: "bold", font: "Rockwell")
  #smallcaps(it.body)
]

#show heading.where(
  level: 3
): it => block(width: 100%)[
  #set align(left)
  #set text(14pt, weight: "bold", font: "Rockwell")
  #smallcaps(it.body)
]

#page(columns: 1)[

  #align(horizon + center)[

    = Dynamic Markdown Text Formatter Using the Decorator Design Pattern

    Adeala Adegbulugbe

    210805078

    Department of Computer Science, University of Lagos

    CSC 322: A Modern Programming Language

    Dr. Sola E. Edagbami

    Project Due: August 8th, 2025

  ]

]

== Abstract


== Introduction


A common issue in software development is the need for objects to have variable and extensible behaviors.

Plainly using inheritance can lead to rigid, bloated class hierarchies and subclass explosions, especially when every extension of a class requires a new subclass.

The Decorator design pattern offers a flexible way to alter object behavior at runtime. It follows the open–closed principle: objects are open to extension but closed to modification.

Markdown is a lightweight, plain-text formatting syntax and a family of tools that convert that syntax to HTML. The original implementation of Markdown was written in Perl; see the Markdown syntax documentation for details.

=== Aim

The aim of this project is to design and implement a dynamic Markdown text formatting system using the Decorator design pattern.

Consider a Markdown text editor that allows users to decorate plain text with formatting such as headings, bold, italic, links, block quotes, and code. Users can combine decorations in any order; for instance the plain text \\\`Hello, World\\\` can be decorated as a heading \\\`# Hello, World\\\` and then combined with bold to produce \\\`# **Hello, World**\\\`.


=== Objective

- Develop a reusable and extensible system for formatting Markdown texts.
- Develop a system that allows dynamic composition of Markdown without modifying the core text classes.
- Demonstrate a practical application of the Decorator pattern to a text-formatting problem.

=== Significance of the study

== Literature review

== Methodology

=== Design

The design follows object-oriented principles using interfaces and composition. The base interface \\\`IMarkdownText\\\` as shown in @interface defines a \\\`Render()\\\` method. A \\\`PlainText\\\` class (see @base-class) implements this interface as the base component. Concrete decorator classes (see @concrete-class) such as \\\`BoldDecorator\\\`, \\\`ItalicDecorator\\\`, \\\`CodeDecorator\\\`, and \\\`HeadingDecorator\\\` inherit from the abstract \\\`MarkdownDecorator\\\` (see @abstract-class) and wrap an existing \\\`IMarkdownText\\\` instance to add behavior.


=== Code

#figure(
\\\`\\\`\\\`cs
public interface IMarkdownText
{
    string Render();
}
\\\`\\\`\\\`
, caption: [interface]
)<interface>

#figure(
  
\\\`\\\`\\\`cs
public class PlainText(string text) : IMarkdownText
{
    private readonly string _text = text;

    public string Render()
    {
        return _text;
    }
}
\\\`\\\`\\\`
,
caption: [base class]
)<base-class>

#figure(
  
\\\`\\\`\\\`cs
public abstract class MarkdownDecorator(IMarkdownText innerText) : IMarkdownText
{
    protected IMarkdownText _innerText = innerText;

    public virtual string Render()
    {
        return _innerText.Render();
    }

}
\\\`\\\`\\\`
,caption: [abstract class]
)<abstract-class>

#figure(
  
\\\`\\\`\\\`\\\`cs
public class BoldDecorator(IMarkdownText innerText) : MarkdownDecorator(innerText)
{
    public override string Render()
    {
        return $"**{base.Render()}**";
    }
}

public class ItalicDecorator(IMarkdownText innerText) : MarkdownDecorator(innerText)
{
    public override string Render()
    {
        return $"*{base.Render()}*";
    }
}

public class CodeDecorator(IMarkdownText innerText) : MarkdownDecorator(innerText)
{
    public override string Render()
    {
        return $"\\\`\\\`\\\`\\\\n{base.Render()}\\\\n\\\`\\\`\\\`";
    }
}

public class HeadingDecorator : MarkdownDecorator
{
    private int _level;
    public HeadingDecorator(IMarkdownText innerText, int level = 1) : base(innerText)
    {
        _level = Math.Clamp(level, 1, 6);
    }
    public override string Render()
    {
        string hashes = String.Concat(Enumerable.Repeat("#", _level));

        return $"{hashes} {base.Render()}";
    }
}
\\\`\\\`\\\`\\\`
,caption: [concrete classes]

)<concrete-class>

== Implementation & Results

#figure(
  
\\\`\\\`\\\`\\\`cs
class Program
{

    public static void Main(string[] args)
    {

        string text = "Hello, World";

        PlainText plainText = new PlainText(text);
        Console.WriteLine(plainText.Render()); // Output: Hello, World

        IMarkdownText boldText = new BoldDecorator(plainText);
        Console.WriteLine(boldText.Render()); // Output: **Hello, World**

        IMarkdownText italicText = new ItalicDecorator(plainText);
        Console.WriteLine(italicText.Render()); // Output: *Hello, World*

        IMarkdownText headingText = new HeadingDecorator(plainText, 3);
        Console.WriteLine(headingText.Render()); // Output: ### Hello, World

        IMarkdownText codingText = new CodeDecorator(new PlainText("Console.WriteLine(\\"Hello, World!\\");"));
        Console.WriteLine(codingText.Render()); // Output: \\\`\\\`\\\` Console.WriteLine("Hello, World!"); \\\`\\\`\\\`

    }
}
\\\`\\\`\\\`\\\`
,caption: [implementation]

)<implementation>
== Conclusion


  `;
